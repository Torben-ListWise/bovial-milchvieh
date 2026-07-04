// Shared SSE writer registry — keyed by analysisId.
// Writers are registered when the client opens the SSE endpoint and removed
// on disconnect or when the agent sends the "done" event.
//
// BUFFERING: The agent may start emitting deltas before the client's SSE
// connection is established. Early events are buffered here and replayed
// asynchronously once a writer registers, so no leading characters are
// dropped and the replay does not arrive as a single TCP burst.

export type SseWriter = {
  sendDelta: (text: string) => void;
  sendSources: (sources: string[]) => void;
  sendProgress: (step: string) => void;
  sendChart: (chart: unknown) => void;
  sendTurnReset: () => void;
  sendDone: () => void;
  sendError: (msg: string) => void;
};

type BufferedEvent =
  | { type: "delta"; text: string }
  | { type: "sources"; sources: string[] }
  | { type: "progress"; step: string }
  | { type: "chart"; chart: unknown }
  | { type: "turn_reset" }
  | { type: "done" }
  | { type: "error"; msg: string };

export const sseWriters = new Map<string, SseWriter>();

// Buffer for events that arrive before the client connects.
const eventBuffers = new Map<string, BufferedEvent[]>();

// Maximum number of buffered events per analysis (safety cap).
const MAX_BUFFER = 2000;

/**
 * Register a writer for the given analysisId and asynchronously replay any
 * buffered events that arrived before the client connected.
 *
 * The writer is registered FIRST so that any new events emitted while the
 * replay is in progress go directly to the writer instead of the buffer.
 * Events are replayed one per setImmediate tick so each res.write() flushes
 * to the socket individually rather than arriving as one TCP burst.
 */
export function registerWriter(id: string, writer: SseWriter): void {
  // Register writer first — new events from here on go directly to the writer.
  sseWriters.set(id, writer);

  const buffered = eventBuffers.get(id);
  if (!buffered || buffered.length === 0) return;
  eventBuffers.delete(id);

  // Replay buffered events one per event-loop tick to avoid a synchronous
  // burst that would appear as a single chunk at the client.
  let i = 0;
  function replayNext() {
    if (i >= buffered!.length) return;
    const ev = buffered![i++];
    // Writer may have been removed if the client disconnected during replay.
    const w = sseWriters.get(id);
    if (!w) return;
    switch (ev.type) {
      case "delta":      w.sendDelta(ev.text); break;
      case "sources":    w.sendSources(ev.sources); break;
      case "progress":   w.sendProgress(ev.step); break;
      case "chart":      w.sendChart(ev.chart); break;
      case "turn_reset": w.sendTurnReset(); break;
      case "done":       w.sendDone(); return; // done ends the stream
      case "error":      w.sendError(ev.msg); return;
    }
    setImmediate(replayNext);
  }
  setImmediate(replayNext);
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
    sendTurnReset: () => {
      const w = sseWriters.get(id);
      if (w) w.sendTurnReset(); else buffer(id, { type: "turn_reset" });
    },
    sendDone: () => {
      const w = sseWriters.get(id);
      if (w) { w.sendDone(); } else buffer(id, { type: "done" });
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
