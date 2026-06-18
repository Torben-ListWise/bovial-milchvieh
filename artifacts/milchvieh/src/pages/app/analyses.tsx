import { useState, useRef, useEffect } from "react";
import { Link } from "wouter";
import {
  useListAnalyses,
  getListAnalysesQueryKey,
  useCreateAnalysis,
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useAskQuestion,
  useListFiles,
  getListFilesQueryKey,
  useRequestUploadUrl,
  useRegisterFile,
  type AnalysisDetail,
} from "@workspace/api-client-react";
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { type AnalysisMessage } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
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
  Bot, User, AlertCircle, Send, Plus, PanelLeft,
  BarChart3, UploadCloud, MessageSquare, TrendingUp,
  Loader2, ChevronRight, Upload, X, Milk,
} from "lucide-react";

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

// ── Progress label helper ────────────────────────────────────────────────────

function stepEmoji(step: string): string {
  if (step.startsWith("Lese")) return "📖";
  if (step.startsWith("Berechne")) return "📊";
  if (step.startsWith("Erstelle")) return "📈";
  if (step.startsWith("Erkenne")) return "⚠️";
  if (step.startsWith("Aggregiere")) return "🔢";
  if (step.startsWith("Lade")) return "📚";
  if (step.startsWith("Überprüfe")) return "🔍";
  return "⚙️";
}

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AnalysisMessage }) {
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

// ── Agent progress panel ─────────────────────────────────────────────────────

function AgentProgressPanel({ step }: { step: string }) {
  return (
    <div className="flex gap-3 justify-start animate-in fade-in slide-in-from-bottom-2">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 space-y-2 min-w-[200px]">
        <div className="flex items-center gap-2 text-sm text-foreground">
          <Loader2 className="w-4 h-4 animate-spin text-primary shrink-0" />
          <span>
            {stepEmoji(step)} {step}…
          </span>
        </div>
        <div className="h-1 bg-muted rounded-full overflow-hidden">
          <div className="h-full bg-primary/40 rounded-full animate-pulse w-3/4" />
        </div>
      </div>
    </div>
  );
}

// ── Conversation sidebar ─────────────────────────────────────────────────────

function ConversationSidebar({
  datasetId,
  activeId,
  onSelect,
  onNew,
}: {
  datasetId: string;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  const { data: analyses, isLoading } = useListAnalyses(datasetId, {
    query: { queryKey: getListAnalysesQueryKey(datasetId) },
  });

  return (
    <div className="flex flex-col h-full bg-secondary/20 border-r border-border">
      <div className="p-3 border-b border-border shrink-0">
        <Button
          size="sm"
          className="w-full gap-2 justify-start"
          onClick={onNew}
        >
          <Plus className="w-4 h-4" />
          Neue Analyse
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1 min-h-0">
        {isLoading ? (
          <div className="space-y-2 p-1">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : !analyses || analyses.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6 px-2">
            Noch keine Analysen
          </p>
        ) : (
          analyses.map((a) => (
            <button
              key={a.id}
              onClick={() => onSelect(a.id)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-lg text-sm transition-colors",
                a.id === activeId
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-muted text-foreground",
              )}
            >
              <p className="font-medium truncate leading-tight">{a.title}</p>
              <p
                className={cn(
                  "text-xs mt-0.5 truncate",
                  a.id === activeId ? "text-primary-foreground/70" : "text-muted-foreground",
                )}
              >
                {format(new Date(a.createdAt), "dd.MM. HH:mm", { locale: de })}
              </p>
            </button>
          ))
        )}
      </div>
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
    <div className="flex-1 flex flex-col items-center justify-center p-6">
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
    ? [...analysis.messages].reverse().find((m) => m.charts && m.charts.length > 0)?.charts?.[0]
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

// ── Main page ────────────────────────────────────────────────────────────────

export function AnalysesPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [activeAnalysisId, setActiveAnalysisId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [mobileTab, setMobileTab] = useState<"chat" | "chart">("chat");
  const [isDragOver, setIsDragOver] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    return sessionStorage.getItem("analysisSidebarOpen") !== "false";
  });

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const askIsPendingRef = useRef(false);

  const requestUrl = useRequestUploadUrl();
  const registerFile = useRegisterFile();

  const { data: files } = useListFiles(datasetId ?? "", {
    query: { enabled: !!datasetId, queryKey: getListFilesQueryKey(datasetId ?? "") },
  });

  const createAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: (data) => {
        setActiveAnalysisId(data.id);
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
        queryClient.setQueryData(getGetAnalysisQueryKey(data.id), data);
        setQuestion("");
        inputRef.current?.focus();
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Analyse konnte nicht gestartet werden." });
      },
    },
  });

  const ask = useAskQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(activeAnalysisId ?? "") });
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
        setQuestion("");
        inputRef.current?.focus();
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Frage konnte nicht gesendet werden." });
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
        if (askIsPendingRef.current) return 2000;
        const data = query.state.data as AnalysisDetail | undefined;
        if ((data as any)?.agentProgress != null) return 2000;
        return false;
      },
    },
  });

  const isAgentWorking =
    (ask.isPending && !!activeAnalysisId) ||
    (analysis?.agentProgress != null);

  const currentStep = analysis?.agentProgress ?? null;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [analysis?.messages?.length, currentStep]);

  function toggleSidebar() {
    setSidebarOpen((prev) => {
      sessionStorage.setItem("analysisSidebarOpen", String(!prev));
      return !prev;
    });
  }

  async function handleSubmit(q?: string) {
    const text = (q ?? question).trim();
    if (!text) return;

    if (!activeAnalysisId) {
      createAnalysis.mutate({ datasetId: datasetId!, data: { title: text, question: text } });
    } else {
      ask.mutate({ analysisId: activeAnalysisId, data: { question: text } });
    }
  }

  function handleStarterQuestion(q: string) {
    setQuestion(q);
    handleSubmit(q);
  }

  function handleNewAnalysis() {
    setActiveAnalysisId(null);
    setQuestion("");
    inputRef.current?.focus();
  }

  // ── Drag-and-drop upload ──────────────────────────────────────────────────

  async function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file || !datasetId) return;

    toast({ title: `📎 ${file.name}`, description: "Wird hochgeladen…" });

    try {
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: { name: file.name, size: file.size, contentType: file.type || "application/octet-stream" },
      });
      await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      await registerFile.mutateAsync({
        datasetId,
        data: { objectPath, name: file.name, contentType: file.type || "application/octet-stream", size: file.size },
      });
      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId) });
      toast({ title: `✅ ${file.name}`, description: "Hochgeladen — wird verarbeitet. Sie können in Kürze Fragen dazu stellen." });
    } catch {
      toast({ variant: "destructive", title: "Upload fehlgeschlagen", description: file.name });
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
    return <div className="h-32 flex items-center justify-center text-muted-foreground">Laden…</div>;
  }

  const hasFiles = !!(files && files.length > 0);
  const isPending = createAnalysis.isPending || ask.isPending;

  // ── Chat zone content ──────────────────────────────────────────────────────

  function renderChatContent() {
    if (!activeAnalysisId && !createAnalysis.isPending) {
      return (
        <StarterQuestions
          hasFiles={hasFiles}
          onAsk={handleStarterQuestion}
        />
      );
    }

    if (createAnalysis.isPending && !activeAnalysisId) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
          <div className="flex gap-3 items-start w-full max-w-lg">
            <div className="w-7 h-7 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
              <User className="w-3.5 h-3.5 text-primary-foreground" />
            </div>
            <div className="bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3 text-sm max-w-md">
              {question}
            </div>
          </div>
          <div className="flex gap-3 items-start w-full max-w-lg">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Agent analysiert Ihre Daten…
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 min-h-0">
        {!analysis ? (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        ) : analysis.messages.length === 0 && !isAgentWorking ? (
          <div className="text-center text-muted-foreground py-12 text-sm">
            Die Analyse wird verarbeitet…
          </div>
        ) : (
          analysis.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}

        {currentStep && (
          <AgentProgressPanel step={currentStep} />
        )}

        {ask.isPending && !currentStep && (
          <div className="flex gap-3 justify-start">
            <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-3.5 h-3.5 text-primary" />
            </div>
            <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Verbinde mit Agent…
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    );
  }

  // ── Layout ─────────────────────────────────────────────────────────────────

  const chatInputArea = (
    <form
      onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
      className="p-3 border-t border-border bg-background shrink-0"
    >
      <div className="flex gap-2 items-center">
        <Input
          ref={inputRef}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={activeAnalysisId ? "Folgefrage stellen…" : "Stellen Sie eine Frage zu Ihren Daten…"}
          className="flex-1"
          disabled={isPending}
        />
        <Button type="submit" size="icon" disabled={isPending || !question.trim()}>
          {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </Button>
      </div>
      {!activeAnalysisId && (
        <p className="text-xs text-muted-foreground mt-1.5 px-1">
          Tipp: Dateien direkt auf diese Seite ziehen zum Hochladen
        </p>
      )}
    </form>
  );

  return (
    <div
      className="flex h-full relative overflow-hidden"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
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

      {/* ── Desktop layout ── */}
      <div className="hidden md:flex w-full h-full">
        {/* Sidebar */}
        <div
          className={cn(
            "shrink-0 transition-all duration-200 overflow-hidden",
            sidebarOpen ? "w-[220px]" : "w-0",
          )}
        >
          {sidebarOpen && (
            <ConversationSidebar
              datasetId={datasetId}
              activeId={activeAnalysisId}
              onSelect={setActiveAnalysisId}
              onNew={handleNewAnalysis}
            />
          )}
        </div>

        {/* Chat zone */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-border">
          {/* Chat header */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 bg-background">
            <Button variant="ghost" size="icon" onClick={toggleSidebar} className="h-8 w-8">
              <PanelLeft className="w-4 h-4" />
            </Button>
            {activeAnalysisId && analysis ? (
              <span className="text-sm font-medium text-foreground truncate">{analysis.title}</span>
            ) : (
              <span className="text-sm font-medium text-foreground">Analysen</span>
            )}
          </div>

          {/* Messages */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {renderChatContent()}
          </div>

          {chatInputArea}
        </div>

        {/* Chart panel */}
        <div className="w-[40%] max-w-[520px] shrink-0 flex flex-col bg-background">
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

      {/* ── Mobile layout ── */}
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
