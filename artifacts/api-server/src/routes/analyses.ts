import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
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
import { sseWriters, type SseWriter } from "../lib/sseRegistry";

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
    contextFileIds: ((a as any).contextFileIds as string[] | null) ?? [],
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
    backQuestions: ((m as any).backQuestions as string[] | null) ?? null,
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

    // Single aggregation query — avoids N+1 individual COUNT queries.
    const ids = rows.map((r) => r.id);
    const msgCounts =
      ids.length > 0
        ? await db
            .select({
              analysisId: messagesTable.analysisId,
              cnt: sql<number>`count(*)::int`.as("cnt"),
            })
            .from(messagesTable)
            .where(inArray(messagesTable.analysisId, ids))
            .groupBy(messagesTable.analysisId)
        : [];
    const countByAnalysis = new Map(msgCounts.map((r) => [r.analysisId, r.cnt]));

    const out = rows.map((a) => serializeAnalysis(a, countByAnalysis.get(a.id) ?? 0));
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
    const question = parsed.data.question?.trim().slice(0, 4_000);
    const title =
      parsed.data.title?.trim().slice(0, 200) ||
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
        ...(parsed.data.contextFileIds !== undefined
          ? { contextFileIds: parsed.data.contextFileIds }
          : {}),
      } as any)
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
      const id = analysis.id;
      setImmediate(() => {
        processQuestion(analysis, question, {
          onTextDelta: (delta) => sseWriters.get(id)?.sendDelta(delta),
          onSourceSearched: (sources) => sseWriters.get(id)?.sendSources(sources),
          onDone: () => sseWriters.get(id)?.sendDone(),
        }).catch((err) => {
          sseWriters.get(id)?.sendError("Verarbeitungsfehler");
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
      ...(parsed.data.contextFileIds !== undefined ? { contextFileIds: parsed.data.contextFileIds } : {}),
      updatedAt: new Date(),
    } as any)
    .where(eq(analysesTable.id, analysisId))
    .returning();
  res.json(UpdateAnalysisResponse.parse(serializeAnalysis(updated)));
});

// ── GET /analyses/:analysisId/stream ─────────────────────────────────────────
// Server-Sent Events endpoint. The client opens this AFTER submitting a
// question via POST. Auth via standard Bearer token (fetch + ReadableStream).
router.get("/analyses/:analysisId/stream", requireAuth, (req: Request, res: Response) => {
  const { analysisId } = req.params;

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.setHeader("X-Content-Type-Options", "nosniff");

  // Flush headers immediately so the client sees 200 + SSE content-type
  // before any data arrives — critical for proxies and the browser's
  // EventSource / fetch-based SSE consumers.
  res.flushHeaders();

  function flush() {
    // Express may buffer res.write() calls; (res as any).flush() forces
    // the underlying socket to drain immediately (works with compression
    // middleware too via the flush() shim it injects).
    if (typeof (res as any).flush === "function") (res as any).flush();
  }

  function sendEvent(event: string, data: unknown) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flush();
  }

  // Send an initial comment so the client knows the connection is open
  res.write(": connected\n\n");
  flush();

  const writer: SseWriter = {
    sendDelta: (text) => sendEvent("delta", { text }),
    sendSources: (sources) => sendEvent("sources", { sources }),
    sendProgress: (step) => sendEvent("progress", { step }),
    sendChart: (chart) => sendEvent("chart", { chart }),
    sendDone: () => {
      sendEvent("done", {});
      res.end();
      sseWriters.delete(analysisId);
    },
    sendError: (msg) => {
      sendEvent("error", { message: msg });
      res.end();
      sseWriters.delete(analysisId);
    },
  };

  sseWriters.set(analysisId, writer);

  // Heartbeat every 15 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": heartbeat\n\n");
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseWriters.delete(analysisId);
  });
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
    if (parsed.data.question.length > 4_000) {
      res.status(400).json({ error: "Frage zu lang (maximal 4 000 Zeichen)." });
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
      // Pass SSE callbacks via closure over the registry — the SSE connection
      // may open slightly after this fires, so we look up the writer at call
      // time (not now). By the time any text delta fires, the client has had
      // ample time (≥1 tool-call round trip) to open the SSE connection.
      const id = a.id;
      processQuestion(a, parsed.data.question, {
        onTextDelta: (delta) => sseWriters.get(id)?.sendDelta(delta),
        onSourceSearched: (sources) => sseWriters.get(id)?.sendSources(sources),
        onProgress: (step) => sseWriters.get(id)?.sendProgress(step),
        onChart: (chart) => sseWriters.get(id)?.sendChart(chart),
        onDone: () => sseWriters.get(id)?.sendDone(),
      }).catch((err) => {
        sseWriters.get(id)?.sendError("Verarbeitungsfehler");
        logger.error({ err }, "Background ask processQuestion failed");
      });
    });
  },
);

export default router;
