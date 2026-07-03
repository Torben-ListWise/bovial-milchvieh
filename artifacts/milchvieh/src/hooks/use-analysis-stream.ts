import { useState, useRef, useEffect, useCallback } from "react";
import type { Chart } from "@workspace/api-client-react";

export type StreamCallbacks = {
  onDelta: (text: string) => void;
  onProgress: (step: string) => void;
  onChart: (chart: Chart) => void;
  onSources: (sources: string[]) => void;
  onDone: () => void;
  onFallback?: () => void;
};

const MAX_RETRIES = 3;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000] as const;

export function useAnalysisStream(callbacks: StreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const doStream = useCallback((analysisId: string) => {
    if (stoppedRef.current) return;

    // Close any existing EventSource before opening a new one
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }

    const url = `/api/stream?analysisId=${encodeURIComponent(analysisId)}`;

    // Native EventSource: the browser sends this as a proper SSE request with
    // `Accept: text/event-stream`. Browsers and proxies handle this transport
    // more correctly than a fetch+ReadableStream reader.
    const es = new EventSource(url, { withCredentials: true });
    esRef.current = es;

    // Guard against onerror firing after we intentionally closed
    let settled = false;

    function close() {
      settled = true;
      es.close();
      if (esRef.current === es) esRef.current = null;
    }

    es.addEventListener("delta", (e: MessageEvent) => {
      if (stoppedRef.current || settled) return;
      try {
        const data = JSON.parse(e.data) as { text?: string };
        callbacksRef.current.onDelta(data.text ?? "");
      } catch { /* ignore malformed */ }
    });

    es.addEventListener("progress", (e: MessageEvent) => {
      if (stoppedRef.current || settled) return;
      try {
        const data = JSON.parse(e.data) as { step?: string };
        callbacksRef.current.onProgress(data.step ?? "");
      } catch { /* ignore */ }
    });

    es.addEventListener("chart", (e: MessageEvent) => {
      if (stoppedRef.current || settled) return;
      try {
        const data = JSON.parse(e.data) as { chart?: Chart };
        if (data.chart) callbacksRef.current.onChart(data.chart);
      } catch { /* ignore */ }
    });

    es.addEventListener("sources", (e: MessageEvent) => {
      if (stoppedRef.current || settled) return;
      try {
        const data = JSON.parse(e.data) as { sources?: string[] };
        if (data.sources) callbacksRef.current.onSources(data.sources);
      } catch { /* ignore */ }
    });

    es.addEventListener("done", () => {
      if (stoppedRef.current || settled) return;
      close();
      callbacksRef.current.onDone();
    });

    // Server-sent error event (agent failed, not a connection drop)
    es.addEventListener("agenterror", () => {
      if (stoppedRef.current || settled) return;
      close();
      callbacksRef.current.onFallback?.();
    });

    // Connection-level error (network drop, HTTP non-2xx, proxy closed)
    es.onerror = () => {
      if (stoppedRef.current || settled) return;
      close();

      const n = retryCountRef.current;
      if (n < MAX_RETRIES) {
        retryCountRef.current = n + 1;
        const delay = BACKOFF_DELAYS_MS[n] ?? 4000;
        retryTimerRef.current = setTimeout(() => doStream(analysisId), delay);
      } else {
        callbacksRef.current.onFallback?.();
      }
    };
  }, []);

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
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
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

  const pendingDeltaRef = useRef("");
  const rafRef = useRef<number | null>(null);
  const prevStepRef = useRef<string | null>(null);

  const flushDelta = useCallback(() => {
    const delta = pendingDeltaRef.current;
    pendingDeltaRef.current = "";
    rafRef.current = null;
    if (delta) setText((prev) => prev + delta);
  }, []);

  const onDelta = useCallback(
    (delta: string) => {
      pendingDeltaRef.current += delta;
      if (!rafRef.current) {
        rafRef.current = requestAnimationFrame(flushDelta);
      }
    },
    [flushDelta],
  );

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
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingDeltaRef.current = "";
    prevStepRef.current = null;
    setText("");
    setProgressStep(null);
    setCompletedSteps([]);
    setCharts([]);
    setSources([]);
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
  };
}
