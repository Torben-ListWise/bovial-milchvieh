// Shared SSE writer registry — keyed by analysisId.
// Writers are registered when the client opens the SSE endpoint
// (GET /analyses/:id/stream) and removed on disconnect or when the
// agent sends the "done" event.

export type SseWriter = {
  sendDelta: (text: string) => void;
  sendSources: (sources: string[]) => void;
  sendProgress: (step: string) => void;
  sendDone: () => void;
  sendError: (msg: string) => void;
};

export const sseWriters = new Map<string, SseWriter>();
