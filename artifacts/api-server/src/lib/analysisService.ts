import { and, asc, eq } from "drizzle-orm";
import {
  db,
  analysesTable,
  messagesTable,
  activityLogTable,
  rulesTable,
  datasetsTable,
  type Analysis,
  type Message,
} from "@workspace/db";
import { runAgent, MissingApiKeyError, type Chart, type Citation } from "./agent";
import { categorizeQuestion } from "./categorize";
import { logger } from "./logger";
import { normalizeSector } from "./serializers";
import Anthropic from "@anthropic-ai/sdk";

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FALLBACK_CHIPS = [
  "Wie entwickelt sich das über die Zeit?",
  "Was sind meine besten und schwächsten Werte?",
  "Welche Maßnahmen empfiehlst du konkret?",
  "Vergleiche das mit dem Vorjahreszeitraum",
  "Zeig mir das als Diagramm",
  "Wo ist das größte Verbesserungspotenzial?",
];

export async function generateFollowUps(question: string, answer: string): Promise<string[]> {
  try {
    const resp = await anthropicClient.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Frage: "${question.slice(0, 200)}"\nAntwort: "${answer.slice(0, 600)}"\n\nGeneriere genau 3 kurze Folgefragen auf Deutsch (max. 7 Wörter je Frage) als JSON-Array von Strings. Antworte NUR mit dem JSON-Array.`,
      }],
    });
    const raw = resp.content.find(b => b.type === "text")?.text?.trim() ?? "[]";
    // Strip optional markdown code fences (```json ... ``` or ``` ... ```)
    const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (parseErr) {
      logger.error({ err: parseErr, rawText: text }, "generateFollowUps: JSON.parse failed");
      return [];
    }
    if (!Array.isArray(parsed)) {
      logger.warn({ parsed }, "generateFollowUps: response is not an array");
      return [];
    }
    return parsed.slice(0, 3).map(String);
  } catch (err) {
    logger.error({ err }, "generateFollowUps: LLM call failed");
    return [];
  }
}

export type SseCallbacks = {
  onTextDelta?: (delta: string) => void;
  onSourceSearched?: (sources: string[]) => void;
  onProgress?: (step: string) => void;
  onChart?: (chart: Chart) => void;
  onDone?: () => void;
};

// Insert the user message, run the agent grounded on deterministic compute,
// persist the assistant answer, and log activity (metadata only).
export async function processQuestion(
  analysis: Analysis,
  question: string,
  sse?: SseCallbacks,
): Promise<Message> {
  // Outer try/finally ensures agentProgress is always cleared, even when an
  // early DB operation (user-message insert, history fetch, rules load) throws
  // before the inner try/catch/finally around runAgent is reached.
  try {
    await db.insert(messagesTable).values({
      analysisId: analysis.id,
      role: "user",
      content: question,
    });

    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.analysisId, analysis.id))
      .orderBy(asc(messagesTable.createdAt));

    const conversation = history
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content as string,
      }));

    // Load dataset sector for sector-specific agent context
    let sector = "dairy";
    try {
      const [ds] = await db
        .select({ sector: datasetsTable.sector })
        .from(datasetsTable)
        .where(eq(datasetsTable.id, analysis.datasetId));
      if (ds) sector = normalizeSector((ds as any).sector);
    } catch {
      // fallback to dairy
    }

    let content: string;
    let charts: Chart[] = [];
    let citations: Citation[] = [];
    let backQuestions: import("./agent").FarmerQuestion[] = [];
    let error: string | null = null;
    let agentResultText: string | undefined;

    // Load customer-defined rules and pass them as structured context so the
    // agent can reference them in every analysis (e.g. custom thresholds).
    const customerRules = await db
      .select()
      .from(rulesTable)
      .where(and(eq(rulesTable.userId, analysis.userId!), eq(rulesTable.enabled, true)));
    const rulesContext =
      customerRules.length > 0
        ? `\nKundendefinierte Regeln (verwende diese als Hinweise bei der Analyse):\n${customerRules
            .map(
              (r) =>
                `- ${r.name}: ${r.metric} ${r.comparator} ${r.threshold}${r.unit ? " " + r.unit : ""}${r.description ? " (" + r.description + ")" : ""}`,
            )
            .join("\n")}`
        : "";

    // Reset step tracking for this run
    const completedSteps: string[] = [];
    let lastProgressStep: string | null = null;

    // Reset agentSteps for this new run
    await db
      .update(analysesTable)
      .set({ agentSteps: [] } as any)
      .where(eq(analysesTable.id, analysis.id))
      .catch(() => {});

    const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten Hard-Limit
    const agentTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Zeitüberschreitung: Der Assistent hat zu lange gebraucht. Bitte nochmals versuchen.")),
        AGENT_TIMEOUT_MS,
      ),
    );

    try {
      const result = await Promise.race([
        runAgent({
          datasetId: analysis.datasetId,
          conversation,
          sector,
          systemExtra: rulesContext || undefined,
          userId: analysis.userId ?? undefined,
          onTextDelta: sse?.onTextDelta,
          onSourceSearched: sse?.onSourceSearched,
          onChart: sse?.onChart,
          onProgress: async (step: string | null) => {
            // The previous step is now complete — move it to completedSteps
            if (lastProgressStep) completedSteps.push(lastProgressStep);
            lastProgressStep = step;
            await db
              .update(analysesTable)
              .set({ agentProgress: step, agentSteps: [...completedSteps] } as any)
              .where(eq(analysesTable.id, analysis.id));
            // Also push progress to the SSE stream (non-null steps only)
            if (step) sse?.onProgress?.(step);
          },
        }),
        agentTimeout,
      ]);
      content = result.text || "Es konnte keine Antwort erzeugt werden.";
      charts = result.charts;
      citations = result.citations;
      backQuestions = result.backQuestions ?? [];
      agentResultText = result.text;

    } catch (err) {
      logger.error({ err, analysisId: analysis.id }, "runAgent failed");
      if (err instanceof MissingApiKeyError) {
        content = err.message;
      } else if (err instanceof Anthropic.APIError && err.status >= 500) {
        content =
          "Der KI-Dienst ist vorübergehend nicht verfügbar. Bitte versuchen Sie es in wenigen Minuten erneut.";
      } else {
        content =
          "Bei der Analyse ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.";
      }
      error = err instanceof Error ? err.message : "Unbekannter Fehler";
    } finally {
      // Always clear progress indicators, even on error
      await db
        .update(analysesTable)
        .set({ agentProgress: null, agentSteps: [] } as any)
        .where(eq(analysesTable.id, analysis.id))
        .catch(() => {});
    }

    // Await follow-up questions so they are bundled directly into the message.
    let followUpQuestions: string[] = [];
    if (agentResultText) {
      followUpQuestions = await generateFollowUps(question, agentResultText);
      if (followUpQuestions.length < 3) {
        const retry = await generateFollowUps(question, agentResultText);
        if (retry.length > followUpQuestions.length) followUpQuestions = retry;
      }
      // Pad to exactly 3 using fallbacks so chips are always shown
      const used = new Set(followUpQuestions);
      for (const fb of FALLBACK_CHIPS) {
        if (followUpQuestions.length >= 3) break;
        if (!used.has(fb)) { followUpQuestions.push(fb); used.add(fb); }
      }
    }

    const [assistant] = await db
      .insert(messagesTable)
      .values({
        analysisId: analysis.id,
        role: "assistant",
        content,
        charts,
        citations,
        error,
        followUpQuestions: followUpQuestions.length > 0 ? followUpQuestions : null,
        backQuestions: backQuestions.length > 0 ? backQuestions : null,
      } as any)
      .returning();

    // Signal SSE listener that the final result (including citations, charts,
    // follow-up questions) is now persisted and ready to reload from DB.
    sse?.onDone?.();

    const category = analysis.category ?? categorizeQuestion(question);
    await db
      .update(analysesTable)
      .set({ updatedAt: new Date(), category })
      .where(eq(analysesTable.id, analysis.id));

    await db.insert(activityLogTable).values({
      userId: analysis.userId,
      type: "analysis",
      category,
      datasetRef: analysis.datasetId.slice(0, 8),
    });

    return assistant;
  } finally {
    // Outer safety net: clear agentProgress if an early DB operation threw
    // before the inner try/finally around runAgent was reached. Idempotent.
    await db
      .update(analysesTable)
      .set({ agentProgress: null } as any)
      .where(eq(analysesTable.id, analysis.id))
      .catch(() => {});
  }
}
