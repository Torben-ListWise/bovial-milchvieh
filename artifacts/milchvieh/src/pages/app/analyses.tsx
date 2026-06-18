import { useState } from "react";
import {
  useListAnalyses,
  getListAnalysesQueryKey,
  useCreateAnalysis,
  useGetAnalysis,
  getGetAnalysisQueryKey,
  useAskQuestion,
} from "@workspace/api-client-react";
import { type AnalysisMessage } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Search, ChevronLeft, Send, Bot, User, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { DynamicChart } from "@/components/DynamicChart";
import { cn } from "@/lib/utils";

// ── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: AnalysisMessage }) {
  const isAssistant = msg.role === "assistant";
  return (
    <div className={cn("flex gap-3", isAssistant ? "justify-start" : "justify-end")}>
      {isAssistant && (
        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-1">
          <Bot className="w-4 h-4 text-primary" />
        </div>
      )}
      <div className={cn("max-w-[80%] space-y-3", isAssistant ? "" : "items-end flex flex-col")}>
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

        {/* Citations */}
        {isAssistant && msg.citations && msg.citations.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {msg.citations.map((c, i) => (
              <span
                key={i}
                className="text-xs bg-primary/5 border border-primary/20 text-primary px-2 py-0.5 rounded-full"
              >
                {c.label}
              </span>
            ))}
          </div>
        )}

        {/* Charts */}
        {isAssistant && msg.charts && msg.charts.length > 0 && (
          <div className="w-full space-y-4 mt-2">
            {msg.charts.map((chart) => (
              <div key={chart.id} className="bg-card border rounded-xl p-4">
                <DynamicChart chart={chart} />
              </div>
            ))}
          </div>
        )}

        <span className="text-[10px] text-muted-foreground">
          {format(new Date(msg.createdAt), "HH:mm", { locale: de })}
        </span>
      </div>
      {!isAssistant && (
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0 mt-1">
          <User className="w-4 h-4 text-primary-foreground" />
        </div>
      )}
    </div>
  );
}

// ── Analysis detail (chat view) ───────────────────────────────────────────────

function AnalysisDetail({
  analysisId,
  datasetId,
  onBack,
}: {
  analysisId: string;
  datasetId: string;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [followUp, setFollowUp] = useState("");

  const { data: analysis, isLoading } = useGetAnalysis(analysisId);

  const ask = useAskQuestion({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetAnalysisQueryKey(analysisId) });
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId) });
        setFollowUp("");
      },
    },
  });

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!followUp.trim() || ask.isPending) return;
    ask.mutate({ analysisId, data: { question: followUp } });
  };

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-3xl mx-auto">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!analysis) {
    return (
      <div className="text-center text-muted-foreground py-16">Analyse nicht gefunden.</div>
    );
  }

  return (
    <div className="flex flex-col h-full max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6 shrink-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="shrink-0">
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <div className="min-w-0">
          <h2 className="text-xl font-bold text-foreground truncate">{analysis.title}</h2>
          <p className="text-xs text-muted-foreground">
            {format(new Date(analysis.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}
            {analysis.category && ` · ${analysis.category}`}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto space-y-6 mb-4 min-h-0">
        {analysis.messages.length === 0 ? (
          <div className="text-center text-muted-foreground py-12">
            Die Analyse wird verarbeitet…
          </div>
        ) : (
          analysis.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        {ask.isPending && (
          <div className="flex gap-3 justify-start">
            <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="w-4 h-4 text-primary" />
            </div>
            <div className="bg-secondary rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2 text-sm text-muted-foreground">
              <span className="inline-flex gap-1">
                <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-primary/50 rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
              Wird analysiert…
            </div>
          </div>
        )}
      </div>

      {/* Follow-up input */}
      <form onSubmit={handleAsk} className="flex gap-2 shrink-0">
        <Input
          value={followUp}
          onChange={(e) => setFollowUp(e.target.value)}
          placeholder="Stellen Sie eine Folgefrage…"
          className="flex-1"
          disabled={ask.isPending}
        />
        <Button type="submit" disabled={ask.isPending || !followUp.trim()} size="icon">
          <Send className="w-4 h-4" />
        </Button>
      </form>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────

export function AnalysesPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const datasetId = searchParams.get("datasetId");
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");
  const [selectedAnalysisId, setSelectedAnalysisId] = useState<string | null>(null);

  const { data: analyses, isLoading } = useListAnalyses(datasetId ?? "", {
    query: {
      enabled: !!datasetId,
      queryKey: getListAnalysesQueryKey(datasetId ?? ""),
    },
  });

  const createAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
        setSelectedAnalysisId(data.id);
        setQuestion("");
      },
    },
  });

  if (!datasetId) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-4">
        <MessageSquare className="w-12 h-12 text-muted-foreground/40" />
        <p className="text-muted-foreground">
          Bitte wählen Sie zuerst einen Betrieb aus der{" "}
          <a href="/app/datasets" className="underline text-primary">Betriebsliste</a>.
        </p>
      </div>
    );
  }

  if (selectedAnalysisId) {
    return (
      <AnalysisDetail
        analysisId={selectedAnalysisId}
        datasetId={datasetId}
        onBack={() => setSelectedAnalysisId(null)}
      />
    );
  }

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    createAnalysis.mutate({
      datasetId,
      data: { title: question, question },
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Analysen</h1>
          <p className="text-muted-foreground mt-1">
            Fragen Sie den Assistenten nach Erkenntnissen aus Ihren Daten.
          </p>
        </div>
      </div>

      {/* Question input */}
      <Card className="shrink-0 bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <form onSubmit={handleAsk} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Warum ist meine Milchleistung gesunken?"
                className="pl-10 h-12 text-lg bg-background border-primary/20 focus-visible:ring-primary"
                disabled={createAnalysis.isPending}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              disabled={createAnalysis.isPending || !question.trim()}
            >
              {createAnalysis.isPending ? "Wird erstellt…" : "Fragen"}
            </Button>
          </form>
          <div className="flex flex-wrap gap-2 mt-4">
            {["Zellzahl Trend", "Fütterungseffizienz", "Fruchtbarkeitskennzahlen"].map(
              (suggestion) => (
                <span
                  key={suggestion}
                  onClick={() => setQuestion(suggestion)}
                  className="text-xs bg-background border border-border px-3 py-1.5 rounded-full cursor-pointer hover:border-primary transition-colors text-muted-foreground"
                >
                  {suggestion}
                </span>
              ),
            )}
          </div>
        </CardContent>
      </Card>

      {/* Analysis list */}
      <div className="flex-1 flex flex-col space-y-4 min-h-0">
        <h3 className="text-xl font-bold shrink-0">Ihre Analysen</h3>

        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : !analyses || analyses.length === 0 ? (
          <Card className="flex-1 flex flex-col border-dashed bg-secondary/10">
            <CardContent className="flex-1 flex flex-col items-center justify-center text-center p-6 min-h-[300px]">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Noch keine Analysen</h3>
              <p className="text-muted-foreground max-w-md">
                Stellen Sie oben eine Frage zu Ihren Daten, um eine neue Analyse zu starten.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="overflow-y-auto space-y-3">
            {analyses.map((analysis) => (
              <Card
                key={analysis.id}
                className="hover:border-primary/50 transition-colors cursor-pointer group"
                onClick={() => setSelectedAnalysisId(analysis.id)}
              >
                <CardContent className="p-4 flex justify-between items-center">
                  <div className="min-w-0 flex-1">
                    <h4 className="font-medium text-foreground text-lg group-hover:text-primary transition-colors truncate">
                      {analysis.title}
                    </h4>
                    <div className="flex items-center gap-4 mt-1 text-xs text-muted-foreground">
                      <span>
                        {format(new Date(analysis.createdAt), "dd.MM.yyyy HH:mm", {
                          locale: de,
                        })}
                      </span>
                      {analysis.category && (
                        <span className="bg-secondary px-2 py-0.5 rounded">
                          {analysis.category}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronLeft className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors rotate-180" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
