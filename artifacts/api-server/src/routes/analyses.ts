import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  datasetsTable,
  analysesTable,
  messagesTable,
  questionLogTable,
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
import { checkQuota, incrementQuota, maybeSendQuotaWarning } from "../lib/quota";
import { ObjectStorageService } from "../lib/objectStorage";
import { type Chart, type Citation } from "../lib/agent";
import { logger } from "../lib/logger";
import { categorizeQuestion } from "../lib/categorize";
import { processQuestion } from "../lib/analysisService";
import { getOrBufferWriter, registerWriter, removeWriter, type SseWriter } from "../lib/sseRegistry";
import { canReadDataset } from "../lib/teamAccess";

const router: IRouter = Router();

// ── SSE streaming endpoint ────────────────────────────────────────────────────
// The browser opens GET /api/stream?analysisId=X and receives
// text/event-stream events (delta, progress, chart, sources, done, error).
// Uses the same cookie-based Clerk session as all other endpoints (requireAuth),
// which is the only transport that works reliably through the Replit dev proxy.
router.get("/stream", requireAuth, async (req: Request, res: Response) => {
  const analysisId = req.query.analysisId as string | undefined;

  if (!analysisId) {
    res.status(400).json({ error: "Missing analysisId" });
    return;
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Replit-Proxy-Buffering": "no",
    "X-Content-Type-Options": "nosniff",
  });

  // Disable Nagle's algorithm so each token delta is sent as its own TCP
  // packet rather than being batched — essential for real-time streaming
  // through the Replit dev proxy.
  const socket = (res.socket ?? (res as any).req?.socket) as import("net").Socket | undefined;
  if (socket) socket.setNoDelay(true);

  res.flushHeaders();

  // After each res.write() call the socket's own cork/uncork cycle ensures
  // Node.js flushes the write to TCP immediately. Combined with setNoDelay(true)
  // above, each SSE event is sent as its own TCP packet without buffering.
  // There is no compression middleware in this app, so (res as any).flush would
  // always be undefined — we skip that dead check entirely.
  function flushSocket() {
    const sock = (res as any).socket as import("net").Socket | undefined;
    if (sock && !sock.destroyed) {
      sock.uncork();
      sock.cork();
    }
  }

  const keepalive = setInterval(() => {
    if (!res.writableEnded) { res.write(": keepalive\n\n"); flushSocket(); }
  }, 15_000);

  // Named SSE events: `event: <name>\ndata: <json>\n\n`
  // Named events are required for the native EventSource API to dispatch
  // them to the correct addEventListener listeners without buffering.
  function sendSseEvent(name: string, data: object): void {
    if (res.writableEnded) return;
    res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`);
    flushSocket();
  }

  const writer: SseWriter = {
    sendDelta: (text) => sendSseEvent("delta", { text }),
    sendSources: (sources) => sendSseEvent("sources", { sources }),
    sendProgress: (step) => sendSseEvent("progress", { step }),
    sendChart: (chart) => sendSseEvent("chart", { chart }),
    sendTurnReset: () => sendSseEvent("turn_reset", {}),
    sendDone: () => {
      sendSseEvent("done", {});
      clearInterval(keepalive);
      removeWriter(analysisId);
      res.end();
    },
    sendError: (message) => {
      sendSseEvent("agenterror", { message });
      clearInterval(keepalive);
      removeWriter(analysisId);
      res.end();
    },
  };

  registerWriter(analysisId, writer);
  sendSseEvent("connected", {});

  req.on("close", () => {
    clearInterval(keepalive);
    removeWriter(analysisId);
  });
});
const chatObjectStorage = new ObjectStorageService();

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

/**
 * Like ownAnalysis but also allows guests who have access to the dataset.
 * Use for read-only and message-creation operations.
 */
async function canAccessAnalysis(
  analysisId: string,
  userId: string,
): Promise<Analysis | null> {
  const [a] = await db
    .select()
    .from(analysesTable)
    .where(eq(analysesTable.id, analysisId));
  if (!a) return null;
  if (a.userId === userId) return a;
  const canRead = await canReadDataset(a.datasetId, userId);
  return canRead ? a : null;
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
    depthLevel: (["quick", "deep"].includes((a as any).depthLevel ?? "")
      ? ((a as any).depthLevel as "quick" | "deep")
      : null),
    messageCount: messageCount ?? 0,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt ?? null,
  };
}

type FarmerQuestion = { text: string; options?: string[] };

function normalizeBackQuestions(raw: unknown): FarmerQuestion[] | null {
  if (!raw || !Array.isArray(raw) || raw.length === 0) return null;
  return raw.map((item) =>
    typeof item === "string" ? { text: item } : (item as FarmerQuestion),
  );
}

function serializeMessage(m: Message) {
  return {
    id: m.id,
    analysisId: m.analysisId,
    role: m.role as "user" | "assistant",
    content: m.content ?? null,
    followUpQuestions: ((m as any).followUpQuestions as string[] | null) ?? [],
    backQuestions: normalizeBackQuestions((m as any).backQuestions),
    widgetSpec: (m as any).widgetSpec ?? null,
    loggedEvent: (m as any).loggedEvent ?? null,
    charts: (m.charts as Chart[] | null) ?? [],
    citations: (m.citations as Citation[] | null) ?? [],
    error: m.error ?? null,
    imageObjectPath: (m as any).imageObjectPath ?? null,
    createdAt: m.createdAt,
  };
}

router.get(
  "/datasets/:datasetId/analyses",
  requireAuth,
  async (req: Request, res: Response) => {
    const { datasetId } = ListAnalysesParams.parse(req.params);
    const userId = req.userId!;
    const canRead = (await ownDatasetId(datasetId, userId)) || (await canReadDataset(datasetId, userId));
    if (!canRead) {
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
    const userId = req.userId!;
    const canCreate = (await ownDatasetId(datasetId, userId)) || (await canReadDataset(datasetId, userId));
    if (!canCreate) {
      res.status(404).json({ error: "Datensatz nicht gefunden" });
      return;
    }
    // ── Quota check ───────────────────────────────────────────────────────────
    const quotaCheck = await checkQuota(userId);
    if (!quotaCheck.allowed) {
      res.status(402).json({
        error: "quota_exceeded",
        plan: quotaCheck.plan,
        limit: quotaCheck.limit,
        used: quotaCheck.used,
      });
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
        ...(parsed.data.depthLevel !== undefined
          ? { depthLevel: parsed.data.depthLevel }
          : {}),
      } as any)
      .returning();

    if (question) {
      // Signal that processing has started so the frontend starts polling immediately
      await db
        .update(analysesTable)
        .set({ agentProgress: "Wird gestartet…" } as any)
        .where(eq(analysesTable.id, analysis.id));

      // Log question for daily chip generation (fire-and-forget)
      db.insert(questionLogTable)
        .values({ datasetId, userId: req.userId!, questionText: question })
        .catch((err) => logger.warn({ err }, "question_log insert fehlgeschlagen"));
    }

    // Return immediately so the client can start polling for live steps
    res.status(201).json(
      GetAnalysisResponse.parse({
        ...serializeAnalysis(analysis, 0),
        agentProgress: question ? "Wird gestartet…" : null,
        messages: [],
      }),
    );

    // Run the agent in the background after the response is sent.
    // The 200 ms delay gives the client time to open the SSE connection so
    // the writer is registered before the first text delta fires — preventing
    // a burst replay of all events when SSE connects.
    if (question) {
      const id = analysis.id;
      setTimeout(() => {
        const w = getOrBufferWriter(id);
        processQuestion(analysis, question, {
          onTextDelta: (delta) => w.sendDelta(delta),
          onSourceSearched: (sources) => w.sendSources(sources),
          onProgress: (step) => w.sendProgress(step),
          onChart: (chart) => w.sendChart(chart),
          onTurnReset: () => w.sendTurnReset(),
          onDone: () => w.sendDone(),
        })
          .then((msg) => {
            if (!msg.error) {
              incrementQuota(userId)
                .then(() => maybeSendQuotaWarning(userId))
                .catch((err) =>
                  logger.error({ err, userId }, "Quota-Increment fehlgeschlagen"),
                );
            }
          })
          .catch((err) => {
            w.sendError("Verarbeitungsfehler");
            logger.error({ err }, "Background processQuestion failed");
          });
      });
    }
  },
);

router.get("/analyses/:analysisId", requireAuth, async (req: Request, res: Response) => {
  const { analysisId } = GetAnalysisParams.parse(req.params);
  const a = await canAccessAnalysis(analysisId, req.userId!);
  if (!a) {
    res.status(404).json({ error: "Analyse nicht gefunden" });
    return;
  }
  const msgs = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        eq(messagesTable.analysisId, analysisId),
        eq(messagesTable.hidden, false),
      ),
    )
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
      ...(parsed.data.depthLevel !== undefined ? { depthLevel: parsed.data.depthLevel } : {}),
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
  res.setHeader("Cache-Control", "no-cache, no-store, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Tell any intermediate proxy not to buffer this response
  res.setHeader("X-Replit-Proxy-Buffering", "no");

  // Disable Nagle's algorithm: forces small packets (individual text deltas)
  // to be sent immediately rather than being batched into larger TCP segments.
  // This is the same technique Vite uses for its HMR SSE stream.
  const socket = (res.socket ?? (res as any).req?.socket) as import("net").Socket | undefined;
  if (socket) socket.setNoDelay(true);

  // Flush headers immediately so the client sees 200 + SSE content-type
  // before any data arrives — critical for proxies and the browser's
  // EventSource / fetch-based SSE consumers.
  res.flushHeaders();

  function flushSocket() {
    const sock = (res as any).socket as import("net").Socket | undefined;
    if (sock && !sock.destroyed) {
      sock.uncork();
      sock.cork();
    }
  }

  function sendEvent(event: string, data: unknown) {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    flushSocket();
  }

  // Send an initial comment so the client knows the connection is open
  res.write(": connected\n\n");
  flushSocket();

  const writer: SseWriter = {
    sendDelta: (text) => sendEvent("delta", { text }),
    sendSources: (sources) => sendEvent("sources", { sources }),
    sendProgress: (step) => sendEvent("progress", { step }),
    sendChart: (chart) => sendEvent("chart", { chart }),
    sendTurnReset: () => sendEvent("turn_reset", {}),
    sendDone: () => {
      sendEvent("done", {});
      res.end();
      removeWriter(analysisId);
    },
    sendError: (msg) => {
      sendEvent("error", { message: msg });
      res.end();
      removeWriter(analysisId);
    },
  };

  registerWriter(analysisId, writer);

  // Heartbeat every 10 s to keep the connection alive through proxies
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(": heartbeat\n\n");
      flush();
    }
  }, 10_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeWriter(analysisId);
  });
});

router.delete("/analyses/:analysisId", requireAuth, async (req: Request, res: Response) => {
  const { analysisId } = DeleteAnalysisParams.parse(req.params);
  const a = await ownAnalysis(analysisId, req.userId!);
  if (!a) {
    res.status(404).json({ error: "Analyse nicht gefunden" });
    return;
  }
  // DSGVO: clean up chat image files from object storage before deleting message rows
  try {
    const msgRows = await db
      .select({ imageObjectPath: messagesTable.imageObjectPath } as any)
      .from(messagesTable)
      .where(eq(messagesTable.analysisId, analysisId));
    const imagePaths = (msgRows as any[])
      .map((r: any) => r.imageObjectPath)
      .filter((p: unknown): p is string => typeof p === "string" && p.length > 0);
    if (imagePaths.length > 0) {
      await Promise.allSettled(
        imagePaths.map(async (path: string) => {
          try {
            const file = await chatObjectStorage.getObjectEntityFile(path);
            await file.delete();
          } catch (err) {
            logger.warn({ err, path }, "Chat-Bild konnte nicht aus Object-Storage gelöscht werden");
          }
        }),
      );
    }
  } catch (err) {
    logger.warn({ err }, "Chat-Bild DSGVO-Bereinigung fehlgeschlagen — Datenbankzeilen werden trotzdem gelöscht");
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
    const a = await canAccessAnalysis(analysisId, req.userId!);
    if (!a) {
      res.status(404).json({ error: "Analyse nicht gefunden" });
      return;
    }
    // ── Quota check ───────────────────────────────────────────────────────────
    const msgQuotaCheck = await checkQuota(req.userId!);
    if (!msgQuotaCheck.allowed) {
      res.status(402).json({
        error: "quota_exceeded",
        plan: msgQuotaCheck.plan,
        limit: msgQuotaCheck.limit,
        used: msgQuotaCheck.used,
      });
      return;
    }

    // Signal that processing has started so the frontend polls immediately
    await db
      .update(analysesTable)
      .set({ agentProgress: "Wird gestartet…" } as any)
      .where(eq(analysesTable.id, a.id));

    // Log question for daily chip generation (fire-and-forget)
    db.insert(questionLogTable)
      .values({ datasetId: a.datasetId, userId: req.userId!, questionText: parsed.data.question })
      .catch((err) => logger.warn({ err }, "question_log insert fehlgeschlagen"));

    // Return immediately — agent runs in background
    res.status(200).json(AskQuestionResponse.parse({ accepted: true }));

    const msgUserId = req.userId!;
    // 200 ms delay: gives the client time to open the SSE connection so the
    // writer is registered before the agent emits the first text delta —
    // preventing a burst replay of all events when SSE connects.
    setTimeout(() => {
      const id = a.id;
      const w = getOrBufferWriter(id);
      const imageObjectPath = parsed.data.imageObjectPath;
      processQuestion(a, parsed.data.question, {
        onTextDelta: (delta) => w.sendDelta(delta),
        onSourceSearched: (sources) => w.sendSources(sources),
        onProgress: (step) => w.sendProgress(step),
        onChart: (chart) => w.sendChart(chart),
        onTurnReset: () => w.sendTurnReset(),
        onDone: () => w.sendDone(),
      }, imageObjectPath ? { imageObjectPath } : undefined)
        .then((msg) => {
          if (!msg.error) {
            incrementQuota(msgUserId)
              .then(() => maybeSendQuotaWarning(msgUserId))
              .catch((err) =>
                logger.error({ err, userId: msgUserId }, "Quota-Increment fehlgeschlagen"),
              );
          }
        })
        .catch((err) => {
          w.sendError("Verarbeitungsfehler");
          logger.error({ err }, "Background ask processQuestion failed");
        });
    });
  },
);

// ── Chat-Image: Upload-URL anfordern ──────────────────────────────────────────
// Der Browser lädt das Bild direkt in Object-Storage hoch; nur der objectPath
// wird im Nachrichtentext mitgeschickt. Max 20 MB wird im Frontend geprüft.
router.post(
  "/chat-images/upload-url",
  requireAuth,
  async (req: Request, res: Response) => {
    const { contentType } = req.body ?? {};
    const ALLOWED = ["image/jpeg", "image/png", "image/webp"];
    if (!contentType || !ALLOWED.includes(contentType)) {
      res.status(400).json({ error: "Ungültiger Bildtyp. Erlaubt: JPEG, PNG, WEBP" });
      return;
    }
    try {
      const uploadURL = await chatObjectStorage.getObjectEntityUploadURL();
      const objectPath = chatObjectStorage.normalizeObjectEntityPath(uploadURL);
      res.json({ uploadURL, objectPath });
    } catch (err) {
      logger.error({ err }, "Chat-Image Upload-URL konnte nicht erstellt werden");
      res.status(500).json({ error: "Upload-URL konnte nicht erstellt werden" });
    }
  },
);

router.get(
  "/chat-images/download",
  requireAuth,
  async (req: Request, res: Response) => {
    const objectPath = req.query.objectPath as string;
    if (!objectPath) {
      res.status(400).json({ error: "objectPath fehlt" });
      return;
    }
    try {
      const file = await chatObjectStorage.getObjectEntityFile(objectPath);
      const [buffer] = await file.download();
      const ext = objectPath.split(".").pop()?.toLowerCase();
      const contentType =
        ext === "jpg" || ext === "jpeg" ? "image/jpeg"
        : ext === "png" ? "image/png"
        : ext === "webp" ? "image/webp"
        : "application/octet-stream";
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "private, max-age=86400");
      res.send(buffer);
    } catch (err) {
      logger.error({ err, objectPath }, "Chat-Bild konnte nicht geladen werden");
      res.status(404).json({ error: "Bild nicht gefunden" });
    }
  },
);

export default router;
