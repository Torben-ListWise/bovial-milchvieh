import Anthropic from "@anthropic-ai/sdk";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  datasetsTable,
  analysesTable,
  messagesTable,
  activityLogTable,
  type Analysis,
  type Message,
} from "@workspace/db";
import {
  ListAnalysesParams,
  ListAnalysesResponse,
  CreateAnalysisParams,
  CreateAnalysisBody,
  GetAnalysisParams,
  GetAnalysisResponse,
  UpdateAnalysisParams,
  UpdateAnalysisBody,
  UpdateAnalysisResponse,
  DeleteAnalysisParams,
  AskQuestionParams,
  AskQuestionBody,
  AskQuestionResponse,
} from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";
import { runAgent, MissingApiKeyError, type Chart, type Citation } from "../lib/agent";
import { rulesTable } from "@workspace/db";
import { categorizeQuestion } from "../lib/categorize";

const router: IRouter = Router();

async function ownDatasetId(datasetId: string, userId: string): Promise<boolean> {
  const [d] = await db
    .select({ id: datasetsTable.id })
    .from(datasetsTable)
    .where(and(eq(datasetsTable.id, datasetId), eq(datasetsTable.userId, userId)));
  return !!d;
}

async function ownAnalysis(
  analysisId: string,
  userId: string,
): Promise<Analysis | null> {
  const [a] = await db
    .select()
    .from(analysesTable)
    .where(and(eq(analysesTable.id, analysisId), eq(analysesTable.userId, userId)));
  return a ?? null;
}

const anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateFollowUps(question: string, answer: string): Promise<string[]> {
  try {
    const resp = await anthropicClient.messages.create({
      model: "claude-sonnet-4-5",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Frage: "${question.slice(0, 200)}"\nAntwort: "${answer.slice(0, 600)}"\n\nGeneriere genau 3 kurze Folgefragen auf Deutsch (max. 7 Wörter je Frage) als JSON-Array von Strings. Antworte NUR mit dem JSON-Array.`,
      }],
    });
    const text = resp.content.find(b => b.type === "text")?.text?.trim() ?? "[]";
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.slice(0, 3).map(String) : [];
  } catch {
    return [];
  }
}

function serializeAnalysis(a: Analysis, messageCount?: number) {
  return {
    id: a.id,
    datasetId: a.datasetId,
    title: a.title,
    category: a.category ?? null,
    pinned: a.pinned,
    tags: (a.tags as string[]) ?? [],
    source: (["user", "auto", "report"].includes(a.source ?? "")
      ? (a.source as "user" | "auto" | "report")
      : null),
    agentProgress: (a as any).agentProgress ?? null,
    agentSteps: ((a as any).agentSteps as string[] | null) ?? [],
    messageCount: messageCount ?? 0,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt ?? null,
  };
}

function serializeMessage(m: Message) {
  return {
    id: m.id,
    analysisId: m.analysisId,
    role: m.role as "user" | "assistant",
    content: m.content ?? null,
    followUpQuestions: ((m as any).followUpQuestions as string[] | null) ?? [],
    charts: (m.charts as Chart[] | null) ?? [],
    citations: (m.citations as Citation[] | null) ?? [],
    error: m.error ?? null,
    createdAt: m.createdAt,
  };
}

// Insert the user message, run the agent grounded on deterministic compute,
// persist the assistant answer, and log activity (metadata only).
export async function processQuestion(
  analysis: Analysis,
  question: string,
): Promise<Message> {
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

  let content: string;
  let charts: Chart[] = [];
  let citations: Citation[] = [];
  let error: string | null = null;
  let followUpQuestions: string[] = [];

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

  try {
    const result = await runAgent({
      datasetId: analysis.datasetId,
      conversation,
      systemExtra: rulesContext || undefined,
      onProgress: async (step: string | null) => {
        // The previous step is now complete — move it to completedSteps
        if (lastProgressStep) completedSteps.push(lastProgressStep);
        lastProgressStep = step;
        await db
          .update(analysesTable)
          .set({ agentProgress: step, agentSteps: [...completedSteps] } as any)
          .where(eq(analysesTable.id, analysis.id));
      },
    });
    content = result.text || "Es konnte keine Antwort erzeugt werden.";
    charts = result.charts;
    citations = result.citations;

    // Generate follow-up suggestions in parallel with storing the result
    if (result.text) {
      followUpQuestions = await generateFollowUps(question, result.text);
    }
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      content = err.message;
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
    } as any)
    .returning();

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
}

router.get(
  "/datasets/:datasetId/analyses",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = ListAnalysesParams.parse(req.params);
    if (!(await ownDatasetId(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const rows = await db
      .select()
      .from(analysesTable)
      .where(eq(analysesTable.datasetId, datasetId))
      .orderBy(desc(analysesTable.pinned), desc(analysesTable.updatedAt));
    const out = [];
    for (const a of rows) {
      const [c] = await db
        .select({ c: sql<number>`count(*)::int` })
        .from(messagesTable)
        .where(eq(messagesTable.analysisId, a.id));
      out.push(serializeAnalysis(a, c?.c ?? 0));
    }
    res.json(ListAnalysesResponse.parse(out));
  },
);

router.post(
  "/datasets/:datasetId/analyses",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = CreateAnalysisParams.parse(req.params);
    const parsed = CreateAnalysisBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Eingabe" });
      return;
    }
    if (!(await ownDatasetId(datasetId, req.userId!))) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    const question = parsed.data.question?.trim();
    const title =
      parsed.data.title?.trim() ||
      (question
        ? question.length > 60
          ? question.slice(0, 57) + "..."
          : question
        : "Neue Analyse");

    const [analysis] = await db
      .insert(analysesTable)
      .values({
        datasetId,
        userId: req.userId!,
        title,
        category: question ? categorizeQuestion(question) : null,
        source: "user",
      })
      .returning();

    if (question) {
      // Signal that processing has started so the frontend starts polling immediately
      await db
        .update(analysesTable)
        .set({ agentProgress: "Wird gestartet…" } as any)
        .where(eq(analysesTable.id, analysis.id));
    }

    // Return immediately so the client can start polling for live steps
    res.status(201).json(
      GetAnalysisResponse.parse({
        ...serializeAnalysis(analysis, 0),
        agentProgress: question ? "Wird gestartet…" : null,
        messages: [],
      }),
    );

    // Run the agent in the background after the response is sent
    if (question) {
      setImmediate(() => {
        processQuestion(analysis, question).catch((err) => {
          logger.error({ err }, "Background processQuestion failed");
        });
      });
    }
  },
);

router.get("/analyses/:analysisId", requireAuth, async (req: Request, res: Response) => {
  const { analysisId } = GetAnalysisParams.parse(req.params);
  const a = await ownAnalysis(analysisId, req.userId!);
  if (!a) {
    res.status(404).json({ error: "Analyse nicht gefunden" });
    return;
  }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.analysisId, analysisId))
    .orderBy(asc(messagesTable.createdAt));
  res.json(
    GetAnalysisResponse.parse({
      ...serializeAnalysis(a, msgs.length),
      messages: msgs.map(serializeMessage),
    }),
  );
});

router.patch("/analyses/:analysisId", requireAuth, async (req: Request, res: Response) => {
  const { analysisId } = UpdateAnalysisParams.parse(req.params);
  const parsed = UpdateAnalysisBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Ungültige Eingabe" });
    return;
  }
  const a = await ownAnalysis(analysisId, req.userId!);
  if (!a) {
    res.status(404).json({ error: "Analyse nicht gefunden" });
    return;
  }
  const [updated] = await db
    .update(analysesTable)
    .set({
      ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
      ...(parsed.data.category !== undefined ? { category: parsed.data.category } : {}),
      ...(parsed.data.pinned !== undefined ? { pinned: parsed.data.pinned } : {}),
      ...(parsed.data.tags !== undefined ? { tags: parsed.data.tags } : {}),
      updatedAt: new Date(),
    })
    .where(eq(analysesTable.id, analysisId))
    .returning();
  res.json(UpdateAnalysisResponse.parse(serializeAnalysis(updated)));
});

router.delete("/analyses/:analysisId", requireAuth, async (req: Request, res: Response) => {
  const { analysisId } = DeleteAnalysisParams.parse(req.params);
  const a = await ownAnalysis(analysisId, req.userId!);
  if (!a) {
    res.status(404).json({ error: "Analyse nicht gefunden" });
    return;
  }
  await db.delete(messagesTable).where(eq(messagesTable.analysisId, analysisId));
  await db.delete(analysesTable).where(eq(analysesTable.id, analysisId));
  res.status(204).end();
});

router.post(
  "/analyses/:analysisId/messages",
  requireAuth,
  async (req: Request, res: Response) => {
    const { analysisId } = AskQuestionParams.parse(req.params);
    const parsed = AskQuestionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Frage darf nicht leer sein" });
      return;
    }
    const a = await ownAnalysis(analysisId, req.userId!);
    if (!a) {
      res.status(404).json({ error: "Analyse nicht gefunden" });
      return;
    }
    // Signal that processing has started so the frontend polls immediately
    await db
      .update(analysesTable)
      .set({ agentProgress: "Wird gestartet…" } as any)
      .where(eq(analysesTable.id, a.id));

    // Return immediately — agent runs in background
    res.status(200).json(AskQuestionResponse.parse({ accepted: true }));

    setImmediate(() => {
      processQuestion(a, parsed.data.question).catch((err) => {
        logger.error({ err }, "Background ask processQuestion failed");
      });
    });
  },
);

export default router;
