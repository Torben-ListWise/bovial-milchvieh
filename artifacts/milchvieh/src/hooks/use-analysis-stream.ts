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

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

export function useAnalysisStream(callbacks: StreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const doStream = useCallback((analysisId: string) => {
    if (stoppedRef.current) return;

    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/analyses/${analysisId}/stream`, {
          signal: ctrl.signal,
          headers: { Accept: "text/event-stream" },
          credentials: "include",
        });

        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        retryCountRef.current = 0;

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });

          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";

          for (const part of parts) {
            if (!part.trim()) continue;
            let eventType = "message";
            let dataLine = "";
            for (const line of part.split("\n")) {
              if (line.startsWith("event:")) eventType = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLine = line.slice(5).trim();
            }
            if (!dataLine) continue;

            try {
              const payload = JSON.parse(dataLine);
              const cb = callbacksRef.current;
              if (eventType === "delta") {
                cb.onDelta(payload.text ?? "");
              } else if (eventType === "progress") {
                cb.onProgress(payload.step ?? "");
              } else if (eventType === "chart") {
                cb.onChart(payload.chart as Chart);
              } else if (eventType === "sources") {
                cb.onSources(payload.sources ?? []);
              } else if (eventType === "done") {
                reader.cancel();
                cb.onDone();
                return;
              } else if (eventType === "error") {
                reader.cancel();
                throw new Error(payload.message ?? "SSE error");
              }
            } catch {
              // ignore malformed events
            }
          }
        }
        throw new Error("Stream ended without done event");
      } catch (err) {
        if (stoppedRef.current || ctrl.signal.aborted) return;
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
    abortRef.current?.abort();
    abortRef.current = null;
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
