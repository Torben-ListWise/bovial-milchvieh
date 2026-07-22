import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  analysesTable,
  messagesTable,
  activityLogTable,
  rulesTable,
  farmNotesTable,
  farmDiaryEntriesTable,
  contextFactsTable,
  usersTable,
  datasetsTable,
  betaToolLogsTable,
  type Analysis,
  type Message,
} from "@workspace/db";
import { runAgent, getModelForTask, type ModelTaskType, MissingApiKeyError, type Chart, type Citation, type BetaToolEntry } from "./agent";
import { classifyAndProposeContextFacts } from "./contextFacts";
import { categorizeQuestion } from "./categorize";
import { logger } from "./logger";
import { normalizeSector } from "./serializers";
import { getSubscription, classifyComplexityFromTools, type AnalysisComplexity } from "./quota";
import Anthropic from "@anthropic-ai/sdk";
import { ObjectStorageService } from "./objectStorage";

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function detectImageMimeType(buf: Buffer): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
  if (buf.length >= 4 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.length >= 3 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "image/gif";
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "image/jpeg";
}

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

  // ── Step 1: Investment/stall-planning → deep Opus even on turn 0 ────────────
  // Must be checked FIRST — these keywords also appear in the complexKeywords
  // list below, so checking them before that list ensures they are routed to
  // chat_analysis_deep rather than chat_analysis.
  const investmentStallKeywords = [
    "investition", "investier", "investiere",
    "stall", "umbau", "neubau", "bauplanung",
    "finanzier", "businessplan",
    "langfristig", "rentabilit",
    "strategie", "planung",
  ];
  if (investmentStallKeywords.some((k) => lower.includes(k))) return "chat_analysis_deep";

  // ── Step 2: General complex-signal exclusions → standard full analysis ───────
  const complexKeywords = [
    "trend", "verlauf", "entwicklung", "zeitverlauf", "zeitreihe", "prognose",
    "vergleich", "gegenüber", "unterschied", "vorjahr", "vormonat",
    "kosten", "warum", "ursache", "erklär",
    "optimier",
    "korrelation", "zusammenhang", "anomalie", "ausreißer",
    "ranking", "top", "flop", "benchmark", "bericht",
    "alle", "gesamt", "übersicht",
  ];
  if (complexKeywords.some((k) => lower.includes(k))) return "chat_analysis";

  // ── Step 3: Must reference exactly one concrete dairy/livestock KPI ──────────
  const kpiKeywords = [
    "milchleistung", "milchmenge", "ecm",
    "zellzahl", "scc", "zellgehalt",
    "fettgehalt", "eiweißgehalt", "proteingehalt",
    "melkung", "gemelk",
    "trächtig", "conception", "befruchtung", "brunst",
    "zwischenkalb", "kalbung", "abkalbung",
    "trockensteher", "laktationstag",
    "remontierung", "abgang", "nutzungsdauer",
    "futteraufnahme",
  ];
  const kpiMatches = kpiKeywords.filter((k) => lower.includes(k));
  // Simple path requires exactly one KPI reference — no more, no less
  if (kpiMatches.length !== 1) return "chat_analysis";

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
  onTurnReset?: () => void;
  onDone?: () => void;
};

const chatObjectStorage = new ObjectStorageService();

export type ProcessQuestionResult = {
  message: Message;
  complexity: AnalysisComplexity;
  /** Credits consumed (0 for knowledge-only or failed analyses) */
  credits: number;
  toolsCalled: string[];
  inputTokens: number;
  outputTokens: number;
};

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
): Promise<ProcessQuestionResult> {
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
        const mediaType = detectImageMimeType(imageBuffer);
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
      // Fire a progress event immediately after image download so the client
      // gets visible feedback even when the agent responds with pure text (no
      // tool calls). Without this, the SSE stream is silent until the model
      // finishes generating — causing burst rendering on the frontend.
      sse?.onProgress?.("Bild wird analysiert…");
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
    let agentLoggedEvent: import("./agent").AgentResult["loggedEvent"] = null;
    let agentInputTokens = 0;
    let agentOutputTokens = 0;

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

    // Diary entries of this farmer (last 10 entries within 30 days)
    // NOTE: per-farmer query — NOT the farm-notes operator pattern
    const diaryEntries = await db
      .select({
        entryDate: farmDiaryEntriesTable.entryDate,
        category: farmDiaryEntriesTable.category,
        description: farmDiaryEntriesTable.description,
      })
      .from(farmDiaryEntriesTable)
      .where(
        and(
          eq(farmDiaryEntriesTable.userId, analysis.userId!),
          sql`entry_date >= CURRENT_DATE - INTERVAL '30 days'`,
        ),
      )
      .orderBy(desc(farmDiaryEntriesTable.entryDate))
      .limit(10);

    const CATEGORY_DE: Record<string, string> = {
      feed: "Fütterung",
      infrastructure: "Infrastruktur",
      health: "Tiergesundheit",
      management: "Betriebsführung",
      weather: "Wetter",
      other: "Sonstiges",
    };
    const diaryContext =
      diaryEntries.length > 0
        ? `\nKürzliche Betriebsereignisse (Tagebuch des Landwirts — zeitlich einordnen beim Antworten):\n${diaryEntries
            .map(
              (e) =>
                `- ${e.entryDate} (${CATEGORY_DE[e.category] ?? e.category}): ${e.description}`,
            )
            .join("\n")}`
        : "";

    // Confirmed, dataset-scoped context facts (Task #375). Strictly filtered by
    // dataset_id — never by userId — so facts never leak across datasets, even
    // for the same owner or a team guest with access to multiple farms.
    // Cap the number of injected facts (most recently confirmed first) so the
    // system prompt cannot grow unbounded as owners confirm more facts over time.
    const CONTEXT_FACTS_MAX_COUNT = 30;
    const CONTEXT_FACTS_MAX_CHARS = 3000;
    const contextFactsRaw = await db
      .select({ category: contextFactsTable.category, factText: contextFactsTable.factText })
      .from(contextFactsTable)
      .where(and(eq(contextFactsTable.datasetId, analysis.datasetId), eq(contextFactsTable.status, "aktiv")))
      .orderBy(desc(contextFactsTable.confirmedAt))
      .limit(CONTEXT_FACTS_MAX_COUNT);
    const CONTEXT_FACT_CATEGORY_DE: Record<string, string> = {
      verfahren: "Verfahren",
      ausruestung: "Ausrüstung",
      wartezeiten: "Wartezeiten",
      sonstiges: "Sonstiges",
    };
    const contextFactLines: string[] = [];
    let contextFactsCharCount = 0;
    for (const f of contextFactsRaw) {
      const line = `- [${CONTEXT_FACT_CATEGORY_DE[f.category] ?? f.category}] ${f.factText}`;
      if (contextFactsCharCount + line.length > CONTEXT_FACTS_MAX_CHARS) break;
      contextFactLines.push(line);
      contextFactsCharCount += line.length;
    }
    const contextFactsContext =
      contextFactLines.length > 0
        ? `\nBestätigte Betriebs-Fakten (dauerhafte Eigenschaften dieses Betriebs — beachte diese bei jeder Analyse):\n${contextFactLines.join("\n")}`
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
      const classified = classifyQuestion(question, hasImage);
      const depthLevelRaw = (analysis as any).depthLevel as string | null | undefined;
      const depthLevel: "quick" | "deep" | null =
        depthLevelRaw === "quick" || depthLevelRaw === "deep" ? depthLevelRaw : null;

      // Turn-0 Opus (chat_analysis_deep) is only used when BOTH the pre-routing
      // heuristic detected investment/stall-planning context AND the user has
      // explicitly chosen "Ausführliche Analyse" (depthLevel="deep").
      // In auto/quick mode, investment/stall questions use Sonnet on turn 0 but
      // can still escalate to Opus on turn N+1 via the normal shouldEscalate path.
      const initialTaskType: ModelTaskType =
        classified === "chat_analysis_deep" && depthLevel === "deep"
          ? "chat_analysis_deep"
          : classified === "chat_analysis_deep"
          ? "chat_analysis"
          : classified;

      // Detect whether the IMMEDIATELY PRECEDING assistant message used ask_farmer.
      // Only the last assistant message is checked — a backQuestion anywhere in
      // the history would over-escalate long conversations.
      const lastAssistantMsg = [...history]
        .reverse()
        .find((m) => m.role === "assistant");
      const askFarmerCalledInPriorRound =
        lastAssistantMsg !== undefined &&
        Array.isArray((lastAssistantMsg as any).backQuestions) &&
        ((lastAssistantMsg as any).backQuestions as unknown[]).length > 0;

      const result = await Promise.race([
        runAgent({
          datasetId: analysis.datasetId,
          conversation,
          sector,
          systemExtra: [rulesContext, farmNotesContext, diaryContext, contextFactsContext].filter(Boolean).join("") || undefined,
          userId: analysis.userId ?? undefined,
          isBeta: isBetaUser,
          betaAnalysisId: analysis.id,
          initialTaskType,
          depthLevel,
          askFarmerCalledInPriorRound,
          onTextDelta: sse?.onTextDelta,
          onSourceSearched: sse?.onSourceSearched,
          onChart: sse?.onChart,
          onTurnReset: sse?.onTurnReset,
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
      agentInputTokens = result.inputTokens ?? 0;
      agentOutputTokens = result.outputTokens ?? 0;
      agentEscalationTrigger = result.escalationTrigger ?? null;
      agentLoggedEvent = result.loggedEvent ?? null;

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
        loggedEvent: agentLoggedEvent ?? null,
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
          toolOutput: entry.toolOutput ?? null,
          durationMs: entry.durationMs,
          escalationTrigger: entry.escalationTrigger ?? null,
          escalationReason: entry.escalationReason ?? null,
        })) as any,
      ).catch((err) => logger.warn({ err, analysisId: analysis.id }, "beta_tool_logs insert fehlgeschlagen"));
    }

    // Signal SSE listener that the final result (including citations, charts,
    // follow-up questions) is now persisted and ready to reload from DB.
    sse?.onDone?.();

    // Fire-and-forget: detect durable farm-context facts (Task #375). Never
    // awaited by the response path and all errors are swallowed internally.
    if (!error && assistant?.id) {
      void classifyAndProposeContextFacts({
        datasetId: analysis.datasetId,
        ownerUserId: analysis.userId!,
        question,
        answer: content,
        sourceAnalysisId: analysis.id,
        sourceMessageId: assistant.id,
      });
    }

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

    const toolsCalled = agentToolLog.map((e) => e.toolName);
    const { complexity, credits } = classifyComplexityFromTools(toolsCalled);
    return {
      message: assistant,
      complexity,
      credits: error ? 0 : credits,
      toolsCalled,
      inputTokens: agentInputTokens,
      outputTokens: agentOutputTokens,
    };
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
