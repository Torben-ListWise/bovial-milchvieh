import { useState, useEffect, useRef, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import { ArrowRight, Bot, ChevronRight, Download, Lock, User } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { DynamicChart } from "@/components/DynamicChart";
import type { Chart } from "@workspace/api-client-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Chart PNG download ────────────────────────────────────────────────────────

function resolveCssVars(str: string): string {
  const rootStyle = getComputedStyle(document.documentElement);
  return str.replace(/var\(--([^)]+)\)/g, (_, name) => {
    const value = rootStyle.getPropertyValue(`--${name.trim()}`).trim();
    return value || "currentColor";
  });
}

async function downloadChartAsPng(containerEl: HTMLDivElement, title: string) {
  const svg = containerEl.querySelector("svg");
  if (!svg) return;

  const { width, height } = svg.getBoundingClientRect();
  const w = width || 600;
  const h = height || 300;
  const scale = 2;

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));

  let svgStr = new XMLSerializer().serializeToString(clone);
  svgStr = resolveCssVars(svgStr);

  const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  await new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w * scale;
      canvas.height = h * scale;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.download = `${title || "diagramm"}.png`;
      a.href = canvas.toDataURL("image/png");
      a.click();
      resolve();
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
    img.src = url;
  });
}

// ── Chart card with download button ──────────────────────────────────────────

function ChartCard({ chart, index }: { chart: Chart; index: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = useCallback(async () => {
    if (!containerRef.current || downloading) return;
    setDownloading(true);
    try {
      await downloadChartAsPng(containerRef.current, (chart as any).title || `diagramm-${index + 1}`);
    } finally {
      setDownloading(false);
    }
  }, [chart, index, downloading]);

  return (
    <div className="group relative">
      {(chart as any).title && (
        <p className="text-xs font-medium text-muted-foreground mb-1.5">
          {(chart as any).title}
        </p>
      )}
      <div ref={containerRef} className="h-64">
        <DynamicChart chart={chart} fillContainer />
      </div>
      <button
        onClick={handleDownload}
        disabled={downloading}
        title="Als PNG herunterladen"
        className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground bg-background/80 backdrop-blur-sm border border-border rounded-md px-2 py-1 shadow-sm disabled:opacity-50"
      >
        <Download className="w-3 h-3" />
        {downloading ? "…" : "PNG"}
      </button>
    </div>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface PublicMessage {
  id: string;
  role: string;
  content: string | null;
  charts: Chart[];
  citations: unknown[];
  followUpQuestions: string[];
  createdAt: string;
}

interface PublicAnalysis {
  id: string;
  title: string;
  datasetId: string;
  datasetName: string | null;
  messages: PublicMessage[];
}

// ── Guest banner ──────────────────────────────────────────────────────────────

function GuestBanner() {
  return (
    <div className="w-full bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between gap-4 shrink-0">
      <p className="text-sm font-medium leading-snug">
        Du siehst eine geteilte Analyse. Melde dich an, um eigene Betriebsdaten hochzuladen und Fragen zu stellen.
      </p>
      <div className="flex items-center gap-2 shrink-0">
        <a
          href={`${basePath}/sign-in`}
          className="text-sm font-semibold underline underline-offset-2 opacity-90 hover:opacity-100 whitespace-nowrap"
        >
          Anmelden
        </a>
        <a
          href={`${basePath}/sign-up`}
          className="inline-flex items-center gap-1 text-sm font-semibold bg-white text-primary px-3 py-1.5 rounded-lg hover:bg-white/90 transition-colors whitespace-nowrap"
        >
          Jetzt registrieren
          <ArrowRight className="w-3.5 h-3.5" />
        </a>
      </div>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────────

const TABLE_TAG_NAMES = ["table", "thead", "tbody", "tr", "th", "td", "colgroup", "col"] as const;

const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "span",
    ...TABLE_TAG_NAMES,
  ],
  attributes: {
    ...defaultSchema.attributes,
    span: ["class"],
    th: ["align", "scope"],
    td: ["align"],
  },
};

const TABLE_COMPONENTS = {
  table({ children }: { children?: React.ReactNode }) {
    return <div className="overflow-x-auto"><table>{children}</table></div>;
  },
};

const PROSE_CLASSES =
  "prose prose-sm max-w-none " +
  "prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-3 prose-headings:mb-1 " +
  "prose-p:text-foreground prose-p:my-1.5 prose-p:leading-relaxed " +
  "prose-strong:text-foreground prose-strong:font-semibold " +
  "prose-li:text-foreground prose-li:my-0.5 " +
  "prose-ul:my-1 prose-ol:my-1 " +
  "prose-ul:pl-4 prose-ol:pl-4 " +
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0 " +
  "[&_table]:w-full [&_table]:border-collapse [&_table]:text-sm [&_table]:my-3 " +
  "[&_th]:border [&_th]:border-border [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-semibold [&_th]:bg-muted/60 " +
  "[&_td]:border [&_td]:border-border [&_td]:px-3 [&_td]:py-1.5 [&_td]:align-top " +
  "[&_tbody_tr:nth-child(even)]:bg-muted/20 " +
  "[&_td[align=right]]:text-right [&_th[align=right]]:text-right [&_td[align=center]]:text-center [&_th[align=center]]:text-center";

function GuestFollowUpChips({ questions }: { questions: string[] }) {
  if (questions.length === 0) return null;
  return (
    <div className="flex flex-col gap-2 pl-10">
      <span className="flex items-center gap-1 text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
        <ChevronRight className="w-3 h-3" />
        Weiter fragen
      </span>
      <div className="flex flex-wrap gap-2">
        {questions.map((q, i) => (
          <a
            key={i}
            href={`${basePath}/sign-up`}
            title="Anmelden, um diese Frage zu stellen"
            className="text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors text-left"
          >
            {q}
          </a>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg }: { msg: PublicMessage }) {
  const isUser = msg.role === "user";
  const hasCharts = !isUser && msg.charts && msg.charts.length > 0;
  const hasFollowUps = !isUser && msg.followUpQuestions && msg.followUpQuestions.length > 0;

  return (
    <div className="flex flex-col gap-2">
      <div className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
        {!isUser && (
          <div className="shrink-0 w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center mt-0.5">
            <Bot className="w-4 h-4 text-primary" />
          </div>
        )}
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? "bg-primary text-primary-foreground rounded-tr-sm"
              : "bg-card border border-border rounded-tl-sm"
          }`}
        >
          {isUser ? (
            <p className="whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div className="space-y-4">
              <div className={PROSE_CLASSES}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
                  components={TABLE_COMPONENTS}
                >
                  {msg.content ?? ""}
                </ReactMarkdown>
              </div>
              {hasCharts && (
                <div className="space-y-4 pt-1">
                  {msg.charts.map((chart, i) => (
                    <ChartCard key={(chart as any).id ?? i} chart={chart} index={i} />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        {isUser && (
          <div className="shrink-0 w-7 h-7 rounded-full bg-muted flex items-center justify-center mt-0.5">
            <User className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
      </div>
      {hasFollowUps && (
        <GuestFollowUpChips questions={msg.followUpQuestions.slice(0, 3)} />
      )}
    </div>
  );
}

// ── Disabled chat input ───────────────────────────────────────────────────────

function LockedChatInput() {
  return (
    <div className="border-t border-border bg-card px-4 py-3">
      <div className="relative flex items-center gap-2 bg-muted/50 rounded-xl px-4 py-2.5 cursor-not-allowed">
        <Lock className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm text-muted-foreground flex-1">
          Anmelden, um zu antworten
        </span>
        <a
          href={`${basePath}/sign-in`}
          className="shrink-0 text-xs font-semibold text-primary hover:underline"
        >
          Anmelden →
        </a>
      </div>
    </div>
  );
}

// ── Main guest analysis page ──────────────────────────────────────────────────

interface GuestAnalysisPageProps {
  analysisId: string;
}

export function GuestAnalysisPage({ analysisId }: GuestAnalysisPageProps) {
  const [analysis, setAnalysis] = useState<PublicAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/public/analyses/${encodeURIComponent(analysisId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<PublicAnalysis>;
      })
      .then((data) => {
        if (!cancelled) {
          setAnalysis(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Diese Analyse konnte nicht geladen werden.");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  return (
    <div className="flex flex-col h-[100dvh] bg-background overflow-hidden">
      {/* Top banner */}
      <GuestBanner />

      {/* Narrow app bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border bg-card shrink-0">
        <a href={`${basePath}/`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-6 h-6" />
          <span className="font-bold text-sm text-primary">Bovial</span>
        </a>
        {analysis && (
          <>
            <span className="text-muted-foreground/40 text-sm">/</span>
            <div className="flex items-baseline gap-1.5 min-w-0">
              {analysis.datasetName && (
                <>
                  <span className="text-xs text-muted-foreground truncate max-w-[120px]">{analysis.datasetName}</span>
                  <span className="text-muted-foreground/40 text-xs">/</span>
                </>
              )}
              <span className="text-sm font-medium text-foreground truncate max-w-[200px]">{analysis.title}</span>
            </div>
          </>
        )}
      </div>

      {/* Message area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {loading && (
          <div className="space-y-4 max-w-2xl mx-auto">
            <Skeleton className="h-10 w-3/4 rounded-xl" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-10 w-1/2 ml-auto rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        )}

        {error && (
          <div className="max-w-2xl mx-auto text-center py-16">
            <p className="text-muted-foreground text-sm">{error}</p>
            <a href={`${basePath}/sign-in`} className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
              Anmelden und eigene Analysen erstellen <ArrowRight className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        {!loading && !error && analysis && (
          <div className="max-w-2xl mx-auto w-full space-y-4">
            {analysis.messages.length === 0 && (
              <p className="text-center text-sm text-muted-foreground py-8">
                Diese Analyse enthält noch keine Nachrichten.
              </p>
            )}
            {analysis.messages.map((msg) => (
              <MessageBubble key={msg.id} msg={msg} />
            ))}
          </div>
        )}
      </div>

      {/* Locked chat footer */}
      <LockedChatInput />
    </div>
  );
}
