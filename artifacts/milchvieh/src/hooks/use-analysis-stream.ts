import { useState, useRef, useEffect, useCallback } from "react";
import type { Chart } from "@workspace/api-client-react";
import { getAuthToken } from "@workspace/api-client-react";

export type StreamCallbacks = {
  onDelta: (text: string) => void;
  onProgress: (step: string) => void;
  onChart: (chart: Chart) => void;
  onSources: (sources: string[]) => void;
  onTurnReset?: () => void;
  onDone: () => void;
  onFallback?: () => void;
};

const MAX_RETRIES = 3;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000] as const;

// Parse SSE events from a raw text buffer.
// Returns parsed events and any remaining incomplete data.
function parseSSEBuffer(buffer: string): {
  events: Array<{ type: string; data: string }>;
  remaining: string;
} {
  const events: Array<{ type: string; data: string }> = [];
  const blocks = buffer.split("\n\n");
  // Last element may be incomplete — keep it in the buffer
  const remaining = blocks.pop() ?? "";

  for (const block of blocks) {
    if (!block.trim()) continue;
    let type = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) {
        type = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data = line.slice(5).trim();
      }
      // ignore `:` comment lines (keepalive)
    }
    if (data || type !== "message") {
      events.push({ type, data });
    }
  }

  return { events, remaining };
}

export function useAnalysisStream(callbacks: StreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doStream = useCallback((analysisId: string) => {
    if (stoppedRef.current) return;

    // Abort any existing fetch stream. Wrap in try/catch — in some browsers
    // abort() on a live ReadableStream reader synchronously throws
    // "BodyStreamBuffer was aborted" which would escape as an unhandled rejection.
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }

    const url = `/api/stream?analysisId=${encodeURIComponent(analysisId)}`;
    const controller = new AbortController();
    abortRef.current = controller;

    (async () => {
      let response: Response;
      try {
        const token = await getAuthToken();
        const headers: HeadersInit = { "Accept": "text/event-stream" };
        if (token) headers["Authorization"] = `Bearer ${token}`;

        response = await fetch(url, {
          headers,
          credentials: "include",
          signal: controller.signal,
          // Prevent the browser from buffering the response
          cache: "no-store",
        });
      } catch (err: unknown) {
        if ((err as Error)?.name === "AbortError") return;
        if (stoppedRef.current) return;
        scheduleRetry(analysisId);
        return;
      }

      if (!response.ok) {
        if (stoppedRef.current) return;
        scheduleRetry(analysisId);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        if (stoppedRef.current) return;
        scheduleRetry(analysisId);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || stoppedRef.current) break;

          buffer += decoder.decode(value, { stream: true });
          const { events, remaining } = parseSSEBuffer(buffer);
          buffer = remaining;

          for (const ev of events) {
            if (stoppedRef.current) break;
            dispatch(ev.type, ev.data);
            // Yield to the browser's task queue after each delta so the
            // browser can paint the token before the next one is processed.
            // Without this, all events in a single reader.read() chunk are
            // handled in one synchronous JS task — the browser only paints
            // once at the end, making the entire response appear as a burst.
            // Progress-step events also only become visible after this yield.
            if (ev.type === "delta") {
              await new Promise<void>((r) => setTimeout(r, 0));
            }
          }
        }
      } catch (err: unknown) {
        const e = err as Error;
        if (e?.name === "AbortError") return;
        if (e?.message?.includes("aborted") || e?.message?.includes("Aborted")) return;
        if (stoppedRef.current) return;
        scheduleRetry(analysisId);
      } finally {
        try { reader.cancel(); } catch { /* ignore */ }
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function dispatch(type: string, data: string) {
    try {
      switch (type) {
        case "delta": {
          const parsed = JSON.parse(data) as { text?: string };
          callbacksRef.current.onDelta(parsed.text ?? "");
          break;
        }
        case "progress": {
          const parsed = JSON.parse(data) as { step?: string };
          callbacksRef.current.onProgress(parsed.step ?? "");
          break;
        }
        case "chart": {
          const parsed = JSON.parse(data) as { chart?: Chart };
          if (parsed.chart) callbacksRef.current.onChart(parsed.chart);
          break;
        }
        case "sources": {
          const parsed = JSON.parse(data) as { sources?: string[] };
          if (parsed.sources) callbacksRef.current.onSources(parsed.sources);
          break;
        }
        case "turn_reset":
          callbacksRef.current.onTurnReset?.();
          break;
        case "done":
          callbacksRef.current.onDone();
          cleanup();
          break;
        case "agenterror":
          callbacksRef.current.onFallback?.();
          cleanup();
          break;
        // "connected" and keepalive comments are silently ignored
      }
    } catch { /* ignore malformed JSON */ }
  }

  function cleanup() {
    stoppedRef.current = true;
    abortRef.current = null;
  }

  function scheduleRetry(analysisId: string) {
    cleanup();
    const n = retryCountRef.current;
    if (n < MAX_RETRIES) {
      retryCountRef.current = n + 1;
      const delay = BACKOFF_DELAYS_MS[n] ?? 4000;
      retryTimerRef.current = setTimeout(() => doStream(analysisId), delay);
    } else {
      callbacksRef.current.onFallback?.();
    }
  }

  const startStream = useCallback(
    (analysisId: string) => {
      stoppedRef.current = false;
      retryCountRef.current = 0;
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
      doStream(analysisId);
    },
    [doStream],
  );

  const stopStream = useCallback(() => {
    stoppedRef.current = true;
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (abortRef.current) {
      try { abortRef.current.abort(); } catch { /* ignore */ }
      abortRef.current = null;
    }
  }, []);

  useEffect(() => () => stopStream(), [stopStream]);

  return { startStream, stopStream };
}

// Batched streaming state hook: accumulates deltas and flushes in animation frames
export function useStreamingState() {
  const [text, setText] = useState("");
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [completedSteps, setCompletedSteps] = useState<string[]>([]);
  const [charts, setCharts] = useState<Chart[]>([]);
  const [sources, setSources] = useState<string[]>([]);

  const prevStepRef = useRef<string | null>(null);

  const onDelta = useCallback((delta: string) => {
    // Each delta arrives in its own macrotask (enforced by the setTimeout(0)
    // yield in the read loop), so React 18 auto-batching never combines two
    // tokens into a single render. No flushSync needed here.
    setText((prev) => prev + delta);
  }, []);

  const onProgress = useCallback((step: string) => {
    const prev = prevStepRef.current;
    if (prev) setCompletedSteps((cs) => [...cs, prev]);
    prevStepRef.current = step;
    setProgressStep(step);
  }, []);

  const onChart = useCallback((chart: Chart) => {
    setCharts((prev) => {
      if (prev.some((c) => c.id === chart.id)) return prev;
      return [...prev, chart];
    });
  }, []);

  const onSources = useCallback((incoming: string[]) => {
    setSources((prev) => {
      const seen = new Set(prev);
      const next = [...prev];
      for (const s of incoming) if (!seen.has(s)) next.push(s);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    prevStepRef.current = null;
    setText("");
    setProgressStep(null);
    setCompletedSteps([]);
    setCharts([]);
    setSources([]);
  }, []);

  // Resets only the text buffer (not progress/charts/sources).
  // Used on turn_reset events so Turn-N preamble text is cleared before
  // Turn-N+1 text starts streaming, without losing progress step state.
  const resetText = useCallback(() => {
    setText("");
  }, []);

  return {
    text,
    progressStep,
    completedSteps,
    charts,
    sources,
    onDelta,
    onProgress,
    onChart,
    onSources,
    reset,
    resetText,
  };
}
