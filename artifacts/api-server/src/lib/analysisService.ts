import { and, asc, eq } from "drizzle-orm";
import {
  db,
  analysesTable,
  messagesTable,
  activityLogTable,
  rulesTable,
  farmNotesTable,
  usersTable,
  datasetsTable,
  betaToolLogsTable,
  type Analysis,
  type Message,
} from "@workspace/db";
import { runAgent, getModelForTask, type ModelTaskType, MissingApiKeyError, type Chart, type Citation, type BetaToolEntry } from "./agent";
import { categorizeQuestion } from "./categorize";
import { logger } from "./logger";
import { normalizeSector } from "./serializers";
import { getSubscription } from "./quota";
import Anthropic from "@anthropic-ai/sdk";
import { ObjectStorageService } from "./objectStorage";

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const FALLBACK_CHIPS = [
  "Wie entwickelt sich das über die Zeit?",
  "Was sind meine besten und schwächsten Werte?",
  "Welche Maßnahmen empfiehlst du konkret?",
  "Vergleiche das mit dem Vorjahreszeitraum",
  "Zeig mir das als Diagramm",
  "Wo ist das größte Verbesserungspotenzial?",
];

/**
 * Keyword-based pre-routing heuristic (no LLM call).
 * Returns chat_analysis_simple only when the question refers to a single KPI
 * and contains NO complex signal keywords (trend/investment/comparison/etc.).
 * Any image in the message forces the full analysis path.
 */
function classifyQuestion(q: string, hasImage: boolean): ModelTaskType {
  if (hasImage) return "chat_analysis";
  const lower = q.toLowerCase();

  // Explicit complex-signal exclusions — any match → full analysis
  const complexKeywords = [
    "trend", "verlauf", "entwicklung", "zeitverlauf", "zeitreihe", "prognose",
    "vergleich", "gegenüber", "unterschied", "vorjahr", "vormonat",
    "investition", "investiere", "investier", "kosten", "rentabilit",
    "optimier", "strategie", "warum", "ursache", "erklär",
    "korrelation", "zusammenhang", "anomalie", "ausreißer",
    "ranking", "top", "flop", "benchmark", "bericht",
    "alle", "gesamt", "übersicht",
  ];
  if (complexKeywords.some((k) => lower.includes(k))) return "chat_analysis";

  // Must reference at least one concrete dairy/livestock KPI
  const kpiKeywords = [
    "milch", "milchleistung", "liter", "kg ecm", "ecm",
    "zellzahl", "scc", "zellgehalt", "zellzahl",
    "fett", "fettgehalt", "eiweiß", "eiweißgehalt", "protein",
    "melkung", "gemelk",
    "trächtig", "conception", "befruchtung", "brunst", "pregnancy",
    "zwischenkalb", "kalbung", "abkalbung",
    "trockensteher", "laktation",
    "remontierung", "abgang", "nutzungsdauer",
    "futteraufnahme", "grundfutter",
    "temperature", "temperatur",
  ];
  const hasKpi = kpiKeywords.some((k) => lower.includes(k));
  if (!hasKpi) return "chat_analysis"; // no recognized KPI → don't assume simple

  // Multiple KPI references → complex question
  const kpiMatchCount = kpiKeywords.filter((k) => lower.includes(k)).length;
  if (kpiMatchCount > 2) return "chat_analysis";

  return "chat_analysis_simple";
}

export async function generateFollowUps(question: string, answer: string): Promise<string[]> {
  try {
    const resp = await anthropicClient.messages.create({
      model: getModelForTask("follow_up_generation"),
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Frage: "${question.slice(0, 200)}"\nAntwort: "${answer.slice(0, 600)}"\n\nGeneriere genau 3 kurze Folgefragen auf Deutsch (max. 7 Wörter je Frage) als JSON-Array von Strings. Antworte NUR mit dem JSON-Array.`,
      }],
    });
    const raw = resp.content.find(b => b.type === "text")?.text?.trim() ?? "[]";
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

const chatObjectStorage = new ObjectStorageService();

export type ProcessQuestionOptions = {
  hidden?: boolean;
  imageObjectPath?: string;
};

// Insert the user message, run the agent grounded on deterministic compute,
// persist the assistant answer, and log activity (metadata only).
export async function processQuestion(
  analysis: Analysis,
  question: string,
  sse?: SseCallbacks,
  opts?: ProcessQuestionOptions,
): Promise<Message> {
  try {
    await db.insert(messagesTable).values({
      analysisId: analysis.id,
      role: "user",
      content: question,
      ...(opts?.hidden ? { hidden: true } : {}),
      ...(opts?.imageObjectPath ? { imageObjectPath: opts.imageObjectPath } : {}),
    } as any);

    const history = await db
      .select()
      .from(messagesTable)
      .where(eq(messagesTable.analysisId, analysis.id))
      .orderBy(asc(messagesTable.createdAt));

    const conversation: Array<{ role: "user" | "assistant"; content: string | Anthropic.ContentBlockParam[] }> = history
      .filter((m) => m.content)
      .map((m) => ({
        role: m.role === "assistant" ? ("assistant" as const) : ("user" as const),
        content: m.content as string,
      }));

    // If the current message has an image attached, replace the last user message
    // with an image + text content block so the agent can interpret it visually.
    if (opts?.imageObjectPath) {
      try {
        const file = await chatObjectStorage.getObjectEntityFile(opts.imageObjectPath);
        const [imageBuffer] = await file.download();
        const base64 = imageBuffer.toString("base64");
        const ext = opts.imageObjectPath.split(".").pop()?.toLowerCase() ?? "";
        const mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" =
          ext === "png" ? "image/png"
          : ext === "webp" ? "image/webp"
          : ext === "gif" ? "image/gif"
          : "image/jpeg";
        // Find and replace the last user message with the image content block
        for (let i = conversation.length - 1; i >= 0; i--) {
          if (conversation[i].role === "user") {
            conversation[i] = {
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: question },
              ],
            };
            break;
          }
        }
      } catch (err) {
        logger.warn({ err, imageObjectPath: opts.imageObjectPath }, "Chat-Bild konnte nicht geladen werden — sende nur Text");
      }
    }

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
    let widgetSpec: import("./agent").WidgetSpec | null = null;
    let error: string | null = null;
    let agentResultText: string | undefined;
    let agentToolLog: BetaToolEntry[] = [];
    let agentEscalationTrigger: { type: string; reason: string } | null = null;

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

    // Load free-text farm notes set by operators and inject them alongside structured rules.
    const farmNotes = await db
      .select({ id: farmNotesTable.id, content: farmNotesTable.content })
      .from(farmNotesTable)
      .innerJoin(usersTable, eq(farmNotesTable.userId, usersTable.id))
      .where(and(eq(usersTable.role, "operator"), eq(farmNotesTable.enabled, true)));
    const farmNotesContext =
      farmNotes.length > 0
        ? `\nBetriebshinweise des Landwirts (wichtige Hintergrundinformationen, die bei jeder Analyse beachtet werden sollen):\n${farmNotes
            .map((n) => `- ${n.content}`)
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

    // Check if user is on beta plan — enables structured tool call logging
    let isBetaUser = false;
    try {
      const sub = await getSubscription(analysis.userId!);
      isBetaUser = sub?.plan === "beta";
    } catch {
      // fallback: no beta logging
    }

    const AGENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 Minuten Hard-Limit
    const agentTimeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Zeitüberschreitung: Der Assistent hat zu lange gebraucht. Bitte nochmals versuchen.")),
        AGENT_TIMEOUT_MS,
      ),
    );

    try {
      const hasImage = !!opts?.imageObjectPath;
      const initialTaskType = classifyQuestion(question, hasImage);
      const depthLevelRaw = (analysis as any).depthLevel as string | null | undefined;
      const depthLevel: "quick" | "deep" | null =
        depthLevelRaw === "quick" || depthLevelRaw === "deep" ? depthLevelRaw : null;

      // Detect whether ask_farmer was called in a previous conversation message.
      // If any prior assistant message has backQuestions, the current turn is the
      // user's reply — escalate to Opus immediately so context-gathering continues.
      const askFarmerCalledInPriorRound = history.some(
        (m) =>
          m.role === "assistant" &&
          Array.isArray((m as any).backQuestions) &&
          ((m as any).backQuestions as unknown[]).length > 0,
      );

      const result = await Promise.race([
        runAgent({
          datasetId: analysis.datasetId,
          conversation,
          sector,
          systemExtra: [rulesContext, farmNotesContext].filter(Boolean).join("") || undefined,
          userId: analysis.userId ?? undefined,
          isBeta: isBetaUser,
          betaAnalysisId: analysis.id,
          initialTaskType,
          depthLevel,
          askFarmerCalledInPriorRound,
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
      widgetSpec = result.widgetSpec ?? null;
      agentResultText = result.text;
      agentToolLog = result.toolLog ?? [];
      agentEscalationTrigger = result.escalationTrigger ?? null;

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
        widgetSpec: widgetSpec ?? null,
      } as any)
      .returning();

    // For beta users: persist structured tool call log linked to this message (fire-and-forget)
    if (isBetaUser && agentToolLog.length > 0 && assistant?.id) {
      db.insert(betaToolLogsTable).values(
        agentToolLog.map((entry) => ({
          messageId: assistant.id,
          analysisId: analysis.id,
          userId: analysis.userId!,
          toolName: entry.toolName,
          keyParams: entry.keyParams,
          durationMs: entry.durationMs,
          escalationTrigger: entry.escalationTrigger ?? null,
          escalationReason: entry.escalationReason ?? null,
        })) as any,
      ).catch((err) => logger.warn({ err, analysisId: analysis.id }, "beta_tool_logs insert fehlgeschlagen"));
    }

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
