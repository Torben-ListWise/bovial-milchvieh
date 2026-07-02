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
  const abortRef = useRef<AbortController | null>(null);

  const doStream = useCallback((analysisId: string) => {
    if (stoppedRef.current) return;

    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }

    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        if (stoppedRef.current) return;

        const url = `/api/stream?analysisId=${encodeURIComponent(analysisId)}`;

        const response = await fetch(url, { signal: abort.signal, credentials: "include" });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        retryCountRef.current = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (stoppedRef.current) {
            reader.cancel();
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          const events = buffer.split("\n\n");
          buffer = events.pop() ?? "";

          const cb = callbacksRef.current;
          for (const event of events) {
            for (const line of event.split("\n")) {
              if (!line.startsWith("data: ")) continue;
              let msg: Record<string, unknown>;
              try {
                msg = JSON.parse(line.slice(6)) as Record<string, unknown>;
              } catch {
                continue;
              }
              const evName = msg.event as string;

              if (evName === "delta") {
                cb.onDelta((msg.text as string) ?? "");
              } else if (evName === "progress") {
                cb.onProgress((msg.step as string) ?? "");
              } else if (evName === "chart") {
                cb.onChart(msg.chart as Chart);
              } else if (evName === "sources") {
                cb.onSources((msg.sources as string[]) ?? []);
              } else if (evName === "done") {
                cb.onDone();
                reader.cancel();
                return;
              } else if (evName === "error") {
                throw new Error((msg.message as string) ?? "Stream error");
              }
            }
          }
        }
      } catch (err: unknown) {
        if (stoppedRef.current) return;
        if (err instanceof Error && err.name === "AbortError") return;

        const n = retryCountRef.current;
        if (n < MAX_RETRIES) {
          retryCountRef.current = n + 1;
          const delay = BACKOFF_DELAYS_MS[n] ?? 4000;
          retryTimerRef.current = setTimeout(() => doStream(analysisId), delay);
        } else {
          callbacksRef.current.onFallback?.();
        }
      }
    })();
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
    if (abortRef.current) {
      abortRef.current.abort();
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
