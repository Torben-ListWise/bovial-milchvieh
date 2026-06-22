import { useState, useRef, useEffect, memo } from "react";
import ReactMarkdown from "react-markdown";
import { Link, useSearch } from "wouter";
import {
  getListAnalysesQueryKey,
  useListAnalyses,
  useCreateAnalysis,
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useAskQuestion,
  useListFiles,
  getListFilesQueryKey,
  useRequestUploadUrl,
  useRegisterFile,
  useGetFile,
  type AnalysisDetail,
  type Analysis,
} from "@workspace/api-client-react";
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { type AnalysisMessage } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { DynamicChart } from "@/components/DynamicChart";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";
import {
  Bot, User, AlertCircle, Send,
  BarChart3, UploadCloud, MessageSquare, TrendingUp,
  Loader2, ChevronRight, Upload,
  CheckCircle2, Clock, Check, FileText, Sheet, FileSpreadsheet,
  Plus, X, RefreshCw,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type FileItem = {
  id: string;
  name: string;
  status: string;
  kind?: string | null;
  createdAt: Date;
};

type SystemMsgStatus = "uploading" | "processing" | "ready" | "error" | "timeout";

interface SystemMsg {
  id: string;
  fileName: string;
  fileId?: string;
  status: SystemMsgStatus;
}

// ── Starter questions ────────────────────────────────────────────────────────

const STARTER_QUESTIONS = [
  {
    emoji: "🥛",
    title: "Milchleistungs-Trend",
    description: "12-Monats-Verlauf und Spitzentiere",
    question: "Wie hat sich meine Milchleistung in den letzten 12 Monaten entwickelt?",
  },
  {
    emoji: "🔬",
    title: "Zellzahl-Analyse",
    description: "Trend und auffällige Tiere",
    question: "Zeig mir den Zellzahl-Trend und identifiziere auffällige Tiere.",
  },
  {
    emoji: "🌾",
    title: "Fütterungseffizienz",
    description: "Verbrauch und Optimierungspotenzial",
    question: "Wie effizient ist meine Fütterung? Gibt es Verbesserungspotenzial?",
  },
  {
    emoji: "📋",
    title: "Fruchtbarkeit",
    description: "Kennzahlen vs. Normwerte",
    question: "Wie sind meine Fruchtbarkeitskennzahlen im Vergleich zu Normwerten?",
  },
  {
    emoji: "⚠️",
    title: "Ausreißer & Warnungen",
    description: "Auffälligkeiten in den Daten",
    question: "Gibt es Ausreißer oder kritische Auffälligkeiten in meinen Daten?",
  },
  {
    emoji: "💡",
    title: "Handlungsempfehlungen",
    description: "Top-3 Maßnahmen basierend auf Ihren Daten",
    question: "Was sind meine Top-3 Handlungsempfehlungen basierend auf den aktuellen Daten?",
  },
];

// ── Progress label normalization ─────────────────────────────────────────────

function normalizeStep(step: string): { emoji: string; label: string } {
  if (step.startsWith("Lese"))             return { emoji: "📖", label: "Lese Datenschema" };
  if (step.startsWith("Berechne alle"))    return { emoji: "📊", label: "Berechne alle Kennzahlen" };
  if (step.startsWith("Berechne Statistik")) return { emoji: "📊", label: "Berechne Statistiken" };
  if (step.startsWith("Berechne Zeitreihe")) return { emoji: "📈", label: "Berechne Zeitreihe" };
  if (step.startsWith("Erstelle Diagramm")) return { emoji: "📊", label: "Erstelle Diagramm" };
  if (step.startsWith("Erstelle Rangliste")) return { emoji: "🏆", label: "Erstelle Rangliste" };
  if (step.startsWith("Erkenne Ausreißer")) return { emoji: "⚠️", label: "Erkenne Ausreißer" };
  if (step.startsWith("Aggregiere"))      return { emoji: "🔢", label: "Aggregiere Daten nach Gruppe" };
  if (step.startsWith("Lade"))            return { emoji: "📚", label: "Lade Stammdaten" };
  if (step.startsWith("Überprüfe"))       return { emoji: "🔍", label: "Überprüfe Ergebnisse" };
  return { emoji: "⚙️", label: step };
}

// ── Analysis history list ─────────────────────────────────────────────────────

function AnalysisSourceBadge({ source }: { source?: string | null }) {
  if (source === "auto") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-100 text-blue-700 shrink-0">
        Auto
      </span>
    );
  }
  if (source === "template") {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 shrink-0">
        Vorlage
      </span>
    );
  }
  return null;
}

function AnalysisHistoryPanel({
  analyses,
  activeAnalysisId,
  onSelect,
  onNew,
}: {
  analyses: Analysis[];
  activeAnalysisId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  if (analyses.length === 0) return null;
  return (
    <div className="px-3 pt-3 pb-1 border-b border-border/60">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">
          Analysen
        </p>
        <button
          onClick={onNew}
          title="Neue Analyse"
          className="p-0.5 rounded hover:bg-muted transition-colors text-muted-foreground"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
        {analyses.map((a) => (
          <button
            key={a.id}
            onClick={() => onSelect(a.id)}
            className={cn(
              "flex items-center gap-2 text-xs rounded-md px-2 py-1.5 text-left w-full transition-colors",
              activeAnalysisId === a.id
                ? "bg-primary/10 text-primary font-medium"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <span className="flex-1 truncate min-w-0">{a.title}</span>
            <AnalysisSourceBadge source={a.source} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Historical file pills ────────────────────────────────────────────────────

function fileKindIcon(kind?: string | null) {
  if (kind === "pdf") return <FileText className="w-3.5 h-3.5 shrink-0" />;
  if (kind === "csv" || kind === "excel" || kind === "herd_export")
    return <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />;
  return <Sheet className="w-3.5 h-3.5 shrink-0" />;
}

function HistoricalFiles({ files }: { files: FileItem[] }) {
  if (files.length === 0) return null;
  return (
    <div className="px-4 pt-3 pb-1">
      <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">
        Hochgeladene Daten
      </p>
      <div className="flex flex-col gap-1.5">
        {files.map((f) => (
          <div
            key={f.id}
            className={cn(
              "flex items-center gap-2 text-xs rounded-lg px-3 py-2 border",
              f.status === "ready"
                ? "bg-green-50/60 border-green-200/70 text-green-800"
                : f.status === "error"
                ? "bg-red-50/60 border-red-200/70 text-red-700"
                : "bg-muted/60 border-border text-muted-foreground",
            )}
          >
            {fileKindIcon(f.kind)}
            <span className="flex-1 truncate font-medium">{f.name}</span>
            {f.status === "ready" && (
              <CheckCircle2 className="w-3.5 h-3.5 text-green-600 shrink-0" />
            )}
            {f.status === "error" && (
              <AlertCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
            )}
            {(f.status === "uploaded" || f.status === "parsing" || f.status === "mapping") && (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
            )}
            <span className="text-[10px] text-muted-foreground/70 shrink-0">
              {format(new Date(f.createdAt), "dd.MM.", { locale: de })}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 border-t border-border/60" />
    </div>
  );
}

// ── File poller ──────────────────────────────────────────────────────────────
// Renders nothing — polls a single file until ready/error/timeout (2 min)

const POLL_TIMEOUT_MS = 120_000;

function FilePoller({
  fileId,
  onDone,
}: {
  fileId: string;
  onDone: (result: "ready" | "error" | "timeout") => void;
}) {
  const startRef = useRef(Date.now());
  const calledRef = useRef(false);

  const { data } = useGetFile(fileId, {
    query: {
      queryKey: [`/api/files/${fileId}`],
      refetchInterval: (query) => {
        if (calledRef.current) return false;
        const d = query.state.data;
        if (!d) return 3000;
        if (d.status === "ready" || d.status === "error") return false;
        if (Date.now() - startRef.current > POLL_TIMEOUT_MS) return false;
        return 3000;
      },
    },
  });

  useEffect(() => {
    if (!data || calledRef.current) return;
    if (data.status === "ready" || data.status === "error") {
      calledRef.current = true;
      onDone(data.status === "ready" ? "ready" : "error");
    }
  }, [data?.status]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (!calledRef.current) {
        calledRef.current = true;
        onDone("timeout");
      }
    }, POLL_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, []);

  return null;
}

// ── System message bubble ────────────────────────────────────────────────────

function SystemMessageBubble({ msg }: { msg: SystemMsg }) {
  const icons: Record<SystemMsgStatus, React.ReactNode> = {
    uploading:   <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />,
    processing:  <Clock className="w-4 h-4 text-primary animate-pulse shrink-0" />,
    ready:       <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />,
    error:       <AlertCircle className="w-4 h-4 text-destructive shrink-0" />,
    timeout:     <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />,
  };

  const labels: Record<SystemMsgStatus, string> = {
    uploading:  `📎 ${msg.fileName} — wird hochgeladen…`,
    processing: `📎 ${msg.fileName} — wird verarbeitet…`,
    ready:      `✅ ${msg.fileName} — bereit zum Analysieren`,
    error:      `❌ ${msg.fileName} — Verarbeitungsfehler`,
    timeout:    `⏱ ${msg.fileName} — Zeitüberschreitung bei der Verarbeitung`,
  };

  return (
    <div className="flex gap-3 justify-center">
      <div
        className={cn(
          "flex items-center gap-2 px-4 py-2 rounded-full text-sm border",
          msg.status === "ready"
            ? "bg-green-50 border-green-200 text-green-700"
            : msg.status === "error" || msg.status === "timeout"
            ? "bg-destructive/5 border-destructive/20 text-destructive"
            : "bg-muted border-border text-muted-foreground",
        )}
      >
        {icons[msg.status]}
        <span>{labels[msg.status]}</span>
      </div>
    </div>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg, isNew }: { msg: AnalysisMessage; isNew: boolean }) {
  const isAssistant = msg.role === "assistant";
  return (
    <div className={cn("flex gap-3", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant && (
        <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
          <Bot className="w-3.5 h-3.5 text-primary" />
        </div>
      )}
      <div className={cn("max-w-[85%] space-y-2", isAssistant ? "" : "items-end flex flex-col")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 text-sm leading-relaxed",
            isAssistant
              ? "bg-secondary text-foreground rounded-tl-sm"
              : "bg-primary text-primary-foreground rounded-tr-sm",
          )}
        >
          {msg.error ? (
            <span className="flex items-center gap-2 text-destructive">
              <AlertCircle className="w-4 h-4" /> {msg.error}
            </span>
          ) : isAssistant ? (
            <StreamingText text={msg.content ?? ""} animate={isNew} />
          ) : (
            <span className="whitespace-pre-wrap">{msg.content ?? ""}</span>
          )}
        </div>
        {isAssistant && msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {msg.citations.map((c, i) => (
              <span
                key={i}
                className="text-xs bg-primary/5 border border-primary/20 text-primary px-2 py-0.5 rounded-full"
              >
                {c.label}: {c.value}
              </span>
            ))}
          </div>
        )}
        <span className="text-[10px] text-muted-foreground">
          {format(new Date(msg.createdAt), "HH:mm", { locale: de })}
        </span>
      </div>
      {!isAssistant && (
        <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
          <User className="w-3.5 h-3.5 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

// ── Live agent steps timeline ─────────────────────────────────────────────────

function AgentStepsTimeline({
  completedSteps,
  currentStep,
}: {
  completedSteps: string[];
  currentStep: string | null;
}) {
  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 space-y-1.5 min-w-[220px]">
        {completedSteps.map((step, i) => {
          const { emoji, label } = normalizeStep(step);
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground/70">
              <Check className="w-3 h-3 text-green-500 shrink-0" />
              <span>{emoji} {label}</span>
            </div>
          );
        })}
        {currentStep ? (
          <div className="flex items-center gap-2 text-sm text-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
            <span>{normalizeStep(currentStep).emoji} {normalizeStep(currentStep).label}…</span>
          </div>
        ) : completedSteps.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-primary shrink-0" />
            <span>Verbinde mit Agent…</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ── Markdown renderer ────────────────────────────────────────────────────────

const MarkdownContent = memo(function MarkdownContent({ text }: { text: string }) {
  return (
    <div className="prose prose-sm max-w-none
        prose-headings:font-semibold prose-headings:text-foreground prose-headings:mt-3 prose-headings:mb-1
        prose-p:text-foreground prose-p:my-1.5 prose-p:leading-relaxed
        prose-strong:text-foreground prose-strong:font-semibold
        prose-li:text-foreground prose-li:my-0.5
        prose-ul:my-1 prose-ol:my-1
        prose-ul:pl-4 prose-ol:pl-4
        [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown>{text}</ReactMarkdown>
    </div>
  );
});

// ── Streaming text (character-by-character reveal) ────────────────────────────

function StreamingText({ text, animate }: { text: string; animate: boolean }) {
  const [visibleChars, setVisibleChars] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) return;
    let i = 0;
    const id = setInterval(() => {
      i += 10;
      setVisibleChars(i);
      if (i >= text.length) clearInterval(id);
    }, 16);
    return () => clearInterval(id);
  }, [animate, text]);

  const displayText = animate && visibleChars < text.length
    ? text.slice(0, visibleChars)
    : text;

  return <MarkdownContent text={displayText} />;
}

// ── Follow-up question chips ───────────────────────────────────────────────────

function FollowUpChips({
  questions,
  onAsk,
}: {
  questions: string[];
  onAsk: (q: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2 pl-10 animate-in fade-in slide-in-from-bottom-1">
      {questions.map((q, i) => (
        <button
          key={i}
          onClick={() => onAsk(q)}
          className="text-xs px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 transition-colors text-left"
        >
          {q}
        </button>
      ))}
    </div>
  );
}

// ── Starter questions ────────────────────────────────────────────────────────

function StarterQuestions({
  hasFiles,
  onAsk,
}: {
  hasFiles: boolean;
  onAsk: (question: string) => void;
}) {
  if (!hasFiles) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
          <UploadCloud className="w-8 h-8 text-primary" />
        </div>
        <h3 className="text-xl font-semibold mb-2">Noch keine Daten hochgeladen</h3>
        <p className="text-muted-foreground mb-6 max-w-sm">
          Laden Sie zuerst Ihre Herdenmanagement-Exporte hoch, bevor Sie Analysen starten.
        </p>
        <Button asChild>
          <Link href="/app/upload">
            <Upload className="w-4 h-4 mr-2" />
            Zur Upload-Seite
          </Link>
        </Button>
        <p className="text-xs text-muted-foreground mt-4">
          Oder ziehen Sie Dateien direkt auf diese Seite
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-6 overflow-y-auto">
      <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-4">
        <Bot className="w-6 h-6 text-primary" />
      </div>
      <h3 className="text-lg font-semibold mb-1">Womit kann ich helfen?</h3>
      <p className="text-sm text-muted-foreground mb-6">
        Stellen Sie eine Frage oder wählen Sie eine Vorlage:
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
        {STARTER_QUESTIONS.map((q) => (
          <button
            key={q.title}
            onClick={() => onAsk(q.question)}
            className="group text-left p-4 rounded-xl border border-border bg-card hover:border-primary/50 hover:bg-primary/5 transition-all"
          >
            <div className="flex items-start gap-3">
              <span className="text-2xl leading-none mt-0.5">{q.emoji}</span>
              <div className="min-w-0">
                <p className="font-medium text-sm text-foreground group-hover:text-primary transition-colors">
                  {q.title}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{q.description}</p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0 mt-0.5 ml-auto" />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Chart panel ──────────────────────────────────────────────────────────────

function ChartPanel({
  analysis,
  isWorking,
}: {
  analysis: AnalysisDetail | undefined;
  isWorking: boolean;
}) {
  const latestChart = analysis?.messages
    ? [...analysis.messages]
        .reverse()
        .find((m) => m.charts && m.charts.length > 0)?.charts?.[0]
    : undefined;

  if (!analysis) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <BarChart3 className="w-12 h-12 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          Grafiken erscheinen hier sobald der Agent Daten berechnet
        </p>
      </div>
    );
  }

  if (isWorking && !latestChart) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <Loader2 className="w-10 h-10 text-primary animate-spin mb-3" />
        <p className="text-sm text-muted-foreground">Grafik wird berechnet…</p>
      </div>
    );
  }

  if (!latestChart) {
    return (
      <div className="flex flex-col h-full items-center justify-center p-8 text-center">
        <TrendingUp className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-sm text-muted-foreground">
          Noch keine Grafik in diesem Gespräch
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Fragen Sie z.B. nach einem Trend oder Vergleich
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <p className="font-semibold text-sm text-foreground truncate">{latestChart.title}</p>
        {latestChart.basis && (
          <p className="text-xs text-muted-foreground mt-0.5">{latestChart.basis}</p>
        )}
        {isWorking && (
          <div className="flex items-center gap-1.5 mt-1.5">
            <Loader2 className="w-3 h-3 animate-spin text-primary" />
            <span className="text-xs text-primary">Wird aktualisiert…</span>
          </div>
        )}
      </div>
      <div className="flex-1 p-4 min-h-0">
        <DynamicChart chart={latestChart} fillContainer />
      </div>
    </div>
  );
}

// ── Neue Daten verfügbar Banner ──────────────────────────────────────────────

function NeueDatatenBanner({
  onDismiss,
  onNewAnalysis,
}: {
  onDismiss: () => void;
  onNewAnalysis: () => void;
}) {
  return (
    <div className="mx-3 mt-2 mb-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 flex items-start gap-2.5 text-sm animate-in fade-in slide-in-from-top-1">
      <RefreshCw className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-amber-900 text-xs leading-snug">
          Neue Daten verfügbar
        </p>
        <p className="text-amber-700 text-xs mt-0.5 leading-snug">
          Es wurden neue Dateien hochgeladen. Die Erstanalyse basiert noch auf den alten Daten.
        </p>
        <button
          onClick={onNewAnalysis}
          className="mt-1.5 text-xs text-amber-800 font-medium underline underline-offset-2 hover:text-amber-900"
        >
          Neue Analyse starten →
        </button>
      </div>
      <button
        onClick={onDismiss}
        className="p-0.5 rounded hover:bg-amber-200 text-amber-500 hover:text-amber-700 transition-colors shrink-0"
        title="Schließen"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AnalysesPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const searchStr = useSearch();

  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(() => {
    return new URLSearchParams(searchStr).get("analysisId") ?? null;
  });
  const [question, setQuestion] = useState("");
  const [mobileTab, setMobileTab] = useState<"chat" | "chart">("chat");
  const [isDragOver, setIsDragOver] = useState(false);
  const [systemMessages, setSystemMessages] = useState<SystemMsg[]>([]);
  const [chatWidth, setChatWidth] = useState<number>(() => {
    const saved = sessionStorage.getItem("chatPanelWidth");
    return saved ? Math.max(200, Math.min(700, parseInt(saved, 10))) : 320;
  });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [neueDatatenDismissed, setNeueDatatenDismissed] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const askIsPendingRef = useRef(false);
  const pendingQuestionRef = useRef("");
  const dragStartXRef = useRef(0);
  const dragStartWidthRef = useRef(0);
  const chatWidthRef = useRef(chatWidth);
  chatWidthRef.current = chatWidth;
  // Track component mount time so we can detect "new" messages for animation
  const mountedAtRef = useRef(Date.now());

  const requestUrl = useRequestUploadUrl();
  const registerFile = useRegisterFile();

  const { data: files } = useListFiles(datasetId ?? "", {
    query: {
      enabled: !!datasetId,
      queryKey: getListFilesQueryKey(datasetId ?? ""),
    },
  });

  const { data: analysesList } = useListAnalyses(datasetId ?? "", {
    query: {
      enabled: !!datasetId,
      queryKey: getListAnalysesQueryKey(datasetId ?? ""),
      refetchInterval: activeAnalysisId ? false : 5000,
    },
  });

  const createAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: (data) => {
        setActiveAnalysisId(data.id);
        queryClient.invalidateQueries({
          queryKey: getListAnalysesQueryKey(datasetId ?? ""),
        });
        queryClient.setQueryData(getGetAnalysisQueryKey(data.id), data);
        setQuestion("");
        inputRef.current?.focus();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Analyse konnte nicht gestartet werden.",
        });
      },
    },
  });

  const ask = useAskQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getGetAnalysisQueryKey(activeAnalysisId ?? ""),
        });
        queryClient.invalidateQueries({
          queryKey: getListAnalysesQueryKey(datasetId ?? ""),
        });
        setQuestion("");
        inputRef.current?.focus();
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: "Frage konnte nicht gesendet werden.",
        });
      },
    },
  });

  askIsPendingRef.current = ask.isPending;

  const { data: analysis } = useGetAnalysis(activeAnalysisId ?? "", {
    query: {
      enabled: !!activeAnalysisId,
      queryKey: getGetAnalysisQueryKey(activeAnalysisId ?? ""),
      staleTime: 0,
      refetchInterval: (query) => {
        if (askIsPendingRef.current) return 500;
        const data = query.state.data as AnalysisDetail | undefined;
        if (data?.agentProgress != null) return 500;
        // Poll while messages haven't arrived yet (background processing started)
        if ((data?.messages?.length ?? 0) === 0) return 500;
        return false;
      },
    },
  });

  const isAgentWorking =
    (ask.isPending && !!activeAnalysisId) ||
    analysis?.agentProgress != null ||
    // Background agent started but no messages in DB yet
    (!!activeAnalysisId && (analysis?.messages?.length ?? 0) === 0 && !!pendingQuestionRef.current);

  const currentStep = analysis?.agentProgress ?? null;
  const completedSteps = (analysis?.agentSteps as string[] | undefined) ?? [];

  // Helper: is this message new (created after this component mounted)?
  function isNewMessage(msg: AnalysisMessage): boolean {
    return new Date(msg.createdAt).getTime() > mountedAtRef.current;
  }

  // Auto-scroll to bottom only while agent is working (not on initial load)
  useEffect(() => {
    if (isAgentWorking) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [analysis?.messages?.length, currentStep, systemMessages.length, isAgentWorking]);

  // ── Panel resize drag handlers ────────────────────────────────────────────
  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragStartXRef.current && dragStartXRef.current !== 0) return;
      if (!document.body.classList.contains("resizing-panel")) return;
      const delta = e.clientX - dragStartXRef.current;
      const newW = Math.max(200, Math.min(700, dragStartWidthRef.current + delta));
      setChatWidth(newW);
      chatWidthRef.current = newW;
    }
    function onMouseUp() {
      if (document.body.classList.contains("resizing-panel")) {
        document.body.classList.remove("resizing-panel");
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        setIsDraggingPanel(false);
        sessionStorage.setItem("chatPanelWidth", String(chatWidthRef.current));
      }
    }
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, []);

  function handlePanelDragStart(e: React.MouseEvent) {
    dragStartXRef.current = e.clientX;
    dragStartWidthRef.current = chatWidthRef.current;
    document.body.classList.add("resizing-panel");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    setIsDraggingPanel(true);
    e.preventDefault();
  }

  function handleNewAnalysis() {
    setActiveAnalysisId(null);
    setQuestion("");
    inputRef.current?.focus();
  }

  async function handleSubmit(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;

    pendingQuestionRef.current = text;

    // Scroll to top so the new question appears at the top and
    // the answer fills down into the visible area
    requestAnimationFrame(() => {
      if (chatScrollRef.current) chatScrollRef.current.scrollTop = 0;
    });

    if (!activeAnalysisId) {
      createAnalysis.mutate({
        datasetId: datasetId!,
        data: { title: text, question: text },
      });
    } else {
      ask.mutate({ analysisId: activeAnalysisId, data: { question: text } });
    }
  }

  function handleStarterQuestion(q: string) {
    setQuestion(q);
    handleSubmit(q);
  }

  // ── Drag-and-drop upload ────────────────────────────────────────────────────

  function updateSystemMsg(id: string, patch: Partial<SystemMsg>) {
    setSystemMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, ...patch } : m)),
    );
  }

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file || !datasetId) return;

    const msgId = crypto.randomUUID();
    setSystemMessages((prev) => [
      ...prev,
      { id: msgId, fileName: file.name, status: "uploading" },
    ]);

    try {
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        },
      });

      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });

      const registered = await registerFile.mutateAsync({
        datasetId,
        data: {
          objectPath,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        },
      });

      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId) });
      updateSystemMsg(msgId, {
        status: "processing",
        fileId: (registered as any).id ?? undefined,
      });
    } catch {
      updateSystemMsg(msgId, { status: "error" });
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }

  if (datasetLoading || !datasetId) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        Laden…
      </div>
    );
  }

  const hasFiles = !!(files && files.length > 0);
  const isPending = createAnalysis.isPending || ask.isPending;

  // ── Neue Daten verfügbar detection ─────────────────────────────────────────

  const historicalFiles = (files ?? []) as unknown as FileItem[];
  const analysesListItems = analysesList ?? [];

  const autoAnalysis = analysesListItems.find((a) => (a as any).templateRef === "auto_erstanalyse" || a.source === "auto");
  const readyFiles = historicalFiles.filter((f) => f.status === "ready");
  const latestFileTime = readyFiles.length > 0
    ? Math.max(...readyFiles.map((f) => new Date(f.createdAt).getTime()))
    : 0;
  const autoAnalysisTime = autoAnalysis ? new Date((autoAnalysis as any).createdAt).getTime() : 0;
  const showNeueDatatenBanner =
    !neueDatatenDismissed &&
    autoAnalysis != null &&
    latestFileTime > autoAnalysisTime + 30_000; // 30s buffer for race

  // ── Chat zone renderer ─────────────────────────────────────────────────────

  function renderChatContent() {
    if (!activeAnalysisId && !createAnalysis.isPending && systemMessages.length === 0) {
      return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <AnalysisHistoryPanel
            analyses={analysesListItems}
            activeAnalysisId={activeAnalysisId}
            onSelect={(id) => setActiveAnalysisId(id)}
            onNew={handleNewAnalysis}
          />
          {showNeueDatatenBanner && (
            <NeueDatatenBanner
              onDismiss={() => setNeueDatatenDismissed(true)}
              onNewAnalysis={handleNewAnalysis}
            />
          )}
          <div ref={chatScrollRef} className="flex-1 overflow-y-auto min-h-0">
            <HistoricalFiles files={historicalFiles} />
            <StarterQuestions hasFiles={hasFiles} onAsk={handleStarterQuestion} />
          </div>
        </div>
      );
    }

    if (createAnalysis.isPending && !activeAnalysisId) {
      return (
        <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">
          <HistoricalFiles files={historicalFiles} />
          {systemMessages.map((m) => (
            <SystemMessageBubble key={m.id} msg={m} />
          ))}
          <div className="flex gap-3 justify-end">
            <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-[80%]">
              {pendingQuestionRef.current || question}
            </div>
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
              <User className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
          </div>
          <AgentStepsTimeline completedSteps={[]} currentStep={null} />
          <div ref={bottomRef} />
        </div>
      );
    }

    const msgs = analysis?.messages ?? [];
    const lastAssistantIdx = msgs.reduce(
      (acc, m, i) => (m.role === "assistant" ? i : acc),
      -1,
    );

    return (
      <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
        <AnalysisHistoryPanel
          analyses={analysesListItems}
          activeAnalysisId={activeAnalysisId}
          onSelect={(id) => { setActiveAnalysisId(id); pendingQuestionRef.current = ""; }}
          onNew={handleNewAnalysis}
        />
      <div ref={chatScrollRef} className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
        <HistoricalFiles files={historicalFiles} />
        <div className="space-y-5">
          {systemMessages.map((m) => (
            <SystemMessageBubble key={m.id} msg={m} />
          ))}

          {!analysis && activeAnalysisId ? (
            <div className="flex items-center justify-center h-16">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : (
            <>
            {/* Show pending question bubble while background agent hasn't written messages yet */}
            {msgs.length === 0 && isAgentWorking && pendingQuestionRef.current && (
              <div className="flex gap-3 justify-end">
                <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-[80%]">
                  {pendingQuestionRef.current}
                </div>
                <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
                  <User className="w-3.5 h-3.5 text-primary-foreground" />
                </div>
              </div>
            )}
            {msgs.map((msg, idx) => (
              <div key={msg.id}>
                <MessageBubble msg={msg} isNew={isNewMessage(msg)} />
                {/* Follow-up chips after last assistant message, only when idle */}
                {msg.role === "assistant" &&
                  idx === lastAssistantIdx &&
                  !isAgentWorking &&
                  (msg.followUpQuestions?.length ?? 0) > 0 && (
                    <div className="mt-3">
                      <FollowUpChips
                        questions={msg.followUpQuestions!}
                        onAsk={(q) => handleSubmit(q)}
                      />
                    </div>
                  )}
              </div>
            ))}
            </>
          )}

          {isAgentWorking && (
            <AgentStepsTimeline
              completedSteps={completedSteps}
              currentStep={currentStep}
            />
          )}

          <div ref={bottomRef} />
        </div>
      </div>
      </div>
    );
  }

  const chatInputArea = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit();
      }}
      className="p-3 border-t border-border bg-background shrink-0"
    >
      <div className="flex gap-2 items-center">
        <Input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={
            activeAnalysisId
              ? "Folgefrage stellen…"
              : "Stellen Sie eine Frage zu Ihren Daten…"
          }
          className="flex-1"
          disabled={isPending}
        />
        <Button
          type="submit"
          size="icon"
          disabled={isPending || !question.trim()}
        >
          {isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Send className="w-4 h-4" />
          )}
        </Button>
      </div>
      {!activeAnalysisId && (
        <p className="text-xs text-muted-foreground mt-1.5 px-1">
          Tipp: Dateien direkt auf diese Seite ziehen zum Hochladen
        </p>
      )}
    </form>
  );

  // ── File pollers (rendered for each processing file) ──────────────────────
  const filePollers = systemMessages
    .filter((m) => m.status === "processing" && m.fileId)
    .map((m) => (
      <FilePoller
        key={m.fileId}
        fileId={m.fileId!}
        onDone={(result) => {
          updateSystemMsg(m.id, { status: result });
          if (result === "ready") {
            queryClient.invalidateQueries({
              queryKey: getListFilesQueryKey(datasetId),
            });
          }
        }}
      />
    ));

  return (
    <div
      className="flex h-full relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Hidden file pollers */}
      {filePollers}

      {/* Drag-and-drop overlay */}
      {isDragOver && (
        <div className="absolute inset-0 z-50 bg-primary/10 border-2 border-dashed border-primary rounded-lg flex items-center justify-center pointer-events-none">
          <div className="bg-background rounded-xl px-8 py-6 text-center shadow-lg">
            <UploadCloud className="w-10 h-10 text-primary mx-auto mb-2" />
            <p className="font-semibold text-foreground">Datei hier ablegen</p>
            <p className="text-sm text-muted-foreground mt-1">Excel, CSV oder PDF</p>
          </div>
        </div>
      )}

      {/* ── Desktop layout ─────────────────────────────────────────────────── */}
      <div className={cn("hidden md:flex w-full h-full", isDraggingPanel && "select-none")}>
        {/* Chat zone */}
        <div
          className="shrink-0 flex flex-col border-r border-border"
          style={{ width: chatWidth }}
        >
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {renderChatContent()}
          </div>
          {chatInputArea}
        </div>

        {/* Drag handle */}
        <div
          className={cn(
            "w-1 shrink-0 cursor-col-resize hover:bg-primary/40 transition-colors",
            isDraggingPanel ? "bg-primary/50" : "bg-border"
          )}
          onMouseDown={handlePanelDragStart}
        />

        {/* Chart panel */}
        <div className="flex-1 flex flex-col bg-background min-w-0">
          <div className="px-4 py-2 border-b border-border shrink-0 bg-muted/30">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Grafik
            </span>
          </div>
          <div className="flex-1 min-h-0">
            <ChartPanel analysis={analysis} isWorking={isAgentWorking} />
          </div>
        </div>
      </div>

      {/* ── Mobile layout ──────────────────────────────────────────────────── */}
      <div className="flex md:hidden flex-col w-full h-full">
        {/* Mobile tab content */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {mobileTab === "chat" ? (
            <>
              <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
                {renderChatContent()}
              </div>
              {chatInputArea}
            </>
          ) : (
            <div className="flex-1 min-h-0">
              <ChartPanel analysis={analysis} isWorking={isAgentWorking} />
            </div>
          )}
        </div>

        {/* Mobile bottom tab bar */}
        <div className="shrink-0 flex border-t border-border bg-background">
          <button
            onClick={() => setMobileTab("chat")}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs transition-colors",
              mobileTab === "chat"
                ? "text-primary border-t-2 border-primary"
                : "text-muted-foreground",
            )}
          >
            <MessageSquare className="w-5 h-5" />
            Chat
          </button>
          <button
            onClick={() => setMobileTab("chart")}
            className={cn(
              "flex-1 flex flex-col items-center justify-center py-3 gap-0.5 text-xs transition-colors relative",
              mobileTab === "chart"
                ? "text-primary border-t-2 border-primary"
                : "text-muted-foreground",
            )}
          >
            <BarChart3 className="w-5 h-5" />
            Grafik
            {isAgentWorking && (
              <span className="absolute top-2 right-[calc(50%-12px)] w-2 h-2 rounded-full bg-primary animate-pulse" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
