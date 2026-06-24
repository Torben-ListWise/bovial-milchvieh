import { useState, useRef, useEffect, useCallback } from "react";
import type { Chart } from "@workspace/api-client-react";

export type StreamCallbacks = {
  onDelta: (text: string) => void;
  onProgress: (step: string) => void;
  onChart: (chart: Chart) => void;
  onSources: (sources: string[]) => void;
  onDone: () => void;
  onFallback?: () => void;
  /** Return a Clerk JWT; required because the stream endpoint uses Bearer auth. */
  getToken: () => Promise<string | null>;
};

const MAX_RETRIES = 3;
const BACKOFF_DELAYS_MS = [1000, 2000, 4000] as const;

export function useAnalysisStream(callbacks: StreamCallbacks) {
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;

  const stoppedRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const doStream = useCallback((analysisId: string) => {
    if (stoppedRef.current) return;

    // Close any existing WebSocket
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    (async () => {
      try {
        const token = await callbacksRef.current.getToken();
        if (!token) throw new Error("No auth token");
        if (stoppedRef.current) return;

        // Construct WebSocket URL — same host as the page, wss:// protocol
        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const host = window.location.host;
        const url = `${proto}//${host}/api/ws/stream?analysisId=${encodeURIComponent(analysisId)}&token=${encodeURIComponent(token)}`;

        const ws = new WebSocket(url);
        wsRef.current = ws;

        ws.onopen = () => {
          retryCountRef.current = 0;
        };

        ws.onmessage = (evt) => {
          if (stoppedRef.current) return;
          try {
            const msg = JSON.parse(evt.data as string) as Record<string, unknown>;
            const event = msg.event as string;
            const cb = callbacksRef.current;

            if (event === "delta") {
              cb.onDelta((msg.text as string) ?? "");
            } else if (event === "progress") {
              cb.onProgress((msg.step as string) ?? "");
            } else if (event === "chart") {
              cb.onChart(msg.chart as Chart);
            } else if (event === "sources") {
              cb.onSources((msg.sources as string[]) ?? []);
            } else if (event === "done") {
              if (wsRef.current === ws) wsRef.current = null;
              ws.close();
              cb.onDone();
            } else if (event === "error") {
              if (wsRef.current === ws) wsRef.current = null;
              ws.close();
              throw new Error((msg.message as string) ?? "Stream error");
            }
            // "connected" event: no action needed, just confirmation
          } catch (parseErr) {
            // ignore malformed frames
          }
        };

        ws.onerror = () => {
          // onerror is always followed by onclose — handle retry in onclose
        };

        ws.onclose = (evt) => {
          if (wsRef.current === ws) wsRef.current = null;
          if (stoppedRef.current) return;
          // 1000 = normal close (done/error events send this), 4001/4003 = auth errors
          if (evt.code === 1000 || evt.code === 4001 || evt.code === 4003) return;
          // Abnormal close — retry
          const n = retryCountRef.current;
          if (n < MAX_RETRIES) {
            retryCountRef.current = n + 1;
            const delay = BACKOFF_DELAYS_MS[n] ?? 4000;
            retryTimerRef.current = setTimeout(() => doStream(analysisId), delay);
          } else {
            callbacksRef.current.onFallback?.();
          }
        };
      } catch (err) {
        if (stoppedRef.current) return;
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
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.close();
      wsRef.current = null;
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
