import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  db,
  datasetsTable,
  analysesTable,
  messagesTable,
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
import { type Chart, type Citation } from "../lib/agent";
import { logger } from "../lib/logger";
import { categorizeQuestion } from "../lib/categorize";
import { processQuestion } from "../lib/analysisService";

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

function serializeAnalysis(a: Analysis, messageCount?: number) {
  return {
    id: a.id,
    datasetId: a.datasetId,
    title: a.title,
    category: a.category ?? null,
    pinned: a.pinned,
    tags: (a.tags as string[]) ?? [],
    source: (["user", "auto", "report", "template"].includes(a.source ?? "")
      ? (a.source as "user" | "auto" | "report" | "template")
      : null),
    templateRef: (a as any).templateRef ?? null,
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
