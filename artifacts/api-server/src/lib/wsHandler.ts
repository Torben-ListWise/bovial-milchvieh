import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { IncomingMessage } from "http";
import { verifyToken } from "@clerk/express";
import { registerWriter, removeWriter, type SseWriter } from "./sseRegistry";
import { logger } from "./logger";

function sendWsMsg(ws: WebSocket, event: string, data: Record<string, unknown>): void {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify({ event, ...data }));
  } catch {
    // ignore
  }
}

const DEV_BYPASS_USER_ID = process.env.DEV_BYPASS_USER_ID ?? "";

/** Returns the userId from the token, or throws on auth failure. */
async function resolveUserId(token: string): Promise<string> {
  // Dev bypass: only active when NODE_ENV=development and the env var is set.
  if (
    process.env.NODE_ENV === "development" &&
    DEV_BYPASS_USER_ID &&
    token === `dev-bypass-${DEV_BYPASS_USER_ID}`
  ) {
    return DEV_BYPASS_USER_ID;
  }

  const payload = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY! });
  if (!payload?.sub) throw new Error("No sub in token payload");
  return payload.sub;
}

export function attachWebSocketServer(server: Server): void {
  const wss = new WebSocketServer({ server, path: "/api/ws/stream" });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const rawUrl = req.url ?? "";
    let analysisId: string | null = null;
    let token: string | null = null;
    try {
      const url = new URL(rawUrl, "http://localhost");
      analysisId = url.searchParams.get("analysisId");
      token = url.searchParams.get("token");
    } catch {
      ws.close(4000, "Bad request URL");
      return;
    }

    if (!analysisId || !token) {
      ws.close(4001, "Missing analysisId or token");
      return;
    }

    const id = analysisId;

    (async () => {
      try {
        await resolveUserId(token!);

        const writer: SseWriter = {
          sendDelta: (text) => sendWsMsg(ws, "delta", { text }),
          sendSources: (sources) => sendWsMsg(ws, "sources", { sources }),
          sendProgress: (step) => sendWsMsg(ws, "progress", { step }),
          sendChart: (chart) => sendWsMsg(ws, "chart", { chart }),
          sendDone: () => {
            sendWsMsg(ws, "done", {});
            removeWriter(id);
            ws.close(1000, "done");
          },
          sendError: (message) => {
            sendWsMsg(ws, "error", { message });
            removeWriter(id);
            ws.close(1000, "error");
          },
        };

        registerWriter(id, writer);
        sendWsMsg(ws, "connected", {});

        ws.on("close", () => {
          removeWriter(id);
        });

        ws.on("error", (err) => {
          logger.warn({ err, analysisId: id }, "WebSocket error");
          removeWriter(id);
        });
      } catch (err) {
        logger.warn({ err }, "WebSocket auth failed");
        ws.close(4003, "Authentication failed");
      }
    })();
  });

  logger.info("WebSocket server attached at /api/ws/stream");
}
