// Shared SSE/WebSocket writer registry — keyed by analysisId.
// Writers are registered when the client opens the WebSocket endpoint
// and removed on disconnect or when the agent sends the "done" event.
//
// BUFFERING: The agent may start emitting deltas before the client's WebSocket
// auth handshake completes. Early events are buffered here and flushed
// immediately once a writer registers, so no leading characters are dropped.

export type SseWriter = {
  sendDelta: (text: string) => void;
  sendSources: (sources: string[]) => void;
  sendProgress: (step: string) => void;
  sendChart: (chart: unknown) => void;
  sendDone: () => void;
  sendError: (msg: string) => void;
};

type BufferedEvent =
  | { type: "delta"; text: string }
  | { type: "sources"; sources: string[] }
  | { type: "progress"; step: string }
  | { type: "chart"; chart: unknown }
  | { type: "done" }
  | { type: "error"; msg: string };

export const sseWriters = new Map<string, SseWriter>();

// Buffer for events that arrive before the client connects.
const eventBuffers = new Map<string, BufferedEvent[]>();

// Maximum number of buffered events per analysis (safety cap).
const MAX_BUFFER = 2000;

/**
 * Register a writer for the given analysisId and immediately flush any
 * buffered events that arrived before the client connected.
 */
export function registerWriter(id: string, writer: SseWriter): void {
  sseWriters.set(id, writer);

  const buffered = eventBuffers.get(id);
  if (buffered && buffered.length > 0) {
    eventBuffers.delete(id);
    for (const ev of buffered) {
      switch (ev.type) {
        case "delta":    writer.sendDelta(ev.text); break;
        case "sources":  writer.sendSources(ev.sources); break;
        case "progress": writer.sendProgress(ev.step); break;
        case "chart":    writer.sendChart(ev.chart); break;
        case "done":     writer.sendDone(); break;
        case "error":    writer.sendError(ev.msg); break;
      }
    }
  }
}

function buffer(id: string, ev: BufferedEvent): void {
  if (!eventBuffers.has(id)) eventBuffers.set(id, []);
  const buf = eventBuffers.get(id)!;
  if (buf.length < MAX_BUFFER) buf.push(ev);
}

/**
 * Get a proxy writer for the given analysisId.
 * If no writer is registered yet, events are buffered until one connects.
 * Always returns a valid writer object — callers don't need to null-check.
 */
export function getOrBufferWriter(id: string): SseWriter {
  return {
    sendDelta: (text) => {
      const w = sseWriters.get(id);
      if (w) w.sendDelta(text); else buffer(id, { type: "delta", text });
    },
    sendSources: (sources) => {
      const w = sseWriters.get(id);
      if (w) w.sendSources(sources); else buffer(id, { type: "sources", sources });
    },
    sendProgress: (step) => {
      const w = sseWriters.get(id);
      if (w) w.sendProgress(step); else buffer(id, { type: "progress", step });
    },
    sendChart: (chart) => {
      const w = sseWriters.get(id);
      if (w) w.sendChart(chart); else buffer(id, { type: "chart", chart });
    },
    sendDone: () => {
      const w = sseWriters.get(id);
      if (w) { w.sendDone(); } else buffer(id, { type: "done" });
      // Clean up buffer either way
      eventBuffers.delete(id);
    },
    sendError: (msg) => {
      const w = sseWriters.get(id);
      if (w) { w.sendError(msg); } else buffer(id, { type: "error", msg });
      eventBuffers.delete(id);
    },
  };
}

/** Remove writer and any pending buffer for a given analysis. */
export function removeWriter(id: string): void {
  sseWriters.delete(id);
  eventBuffers.delete(id);
}
