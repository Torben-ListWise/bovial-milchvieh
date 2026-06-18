import { useState } from "react";
import { useListAnalyses, getListAnalysesQueryKey, useCreateAnalysis } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { MessageSquare, Search, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";

export function AnalysesPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const datasetId = searchParams.get("datasetId");
  const queryClient = useQueryClient();
  const [question, setQuestion] = useState("");

  const { data: analyses, isLoading } = useListAnalyses(
    datasetId ?? "",
    { query: { enabled: !!datasetId, queryKey: getListAnalysesQueryKey(datasetId ?? "") } }
  );

  const createAnalysis = useCreateAnalysis({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAnalysesQueryKey(datasetId ?? "") });
      }
    }
  });

  if (!datasetId) {
    return <div className="p-8">Bitte wählen Sie einen Betrieb aus der Liste.</div>;
  }

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    createAnalysis.mutate({
      datasetId,
      data: {
        title: question,
        question: question
      }
    });
    setQuestion("");
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-center shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Analysen</h1>
          <p className="text-muted-foreground mt-1">Fragen Sie den Assistenten nach Erkenntnissen aus Ihren Daten.</p>
        </div>
      </div>

      <Card className="shrink-0 bg-primary/5 border-primary/20">
        <CardContent className="p-6">
          <form onSubmit={handleAsk} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
              <Input
                value={question}
                onChange={e => setQuestion(e.target.value)}
                placeholder="Warum ist meine Milchleistung gesunken?"
                className="pl-10 h-12 text-lg bg-background border-primary/20 focus-visible:ring-primary"
                disabled={createAnalysis.isPending}
              />
            </div>
            <Button type="submit" size="lg" disabled={createAnalysis.isPending || !question.trim()}>
              Fragen
            </Button>
          </form>
          <div className="flex flex-wrap gap-2 mt-4">
            {["Zellzahl Trend", "Fütterungseffizienz", "Fruchtbarkeitskennzahlen"].map(suggestion => (
              <span key={suggestion} onClick={() => setQuestion(suggestion)} className="text-xs bg-background border border-border px-3 py-1.5 rounded-full cursor-pointer hover:border-primary transition-colors text-muted-foreground">
                {suggestion}
              </span>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="flex-1 flex flex-col space-y-4">
        <h3 className="text-xl font-bold">Ihre Analysen</h3>

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
          <div className="grid grid-cols-1 gap-4">
            {analyses.map(analysis => (
              <Card key={analysis.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
                <CardContent className="p-4 flex justify-between items-center">
                  <div>
                    <h4 className="font-medium text-foreground text-lg group-hover:text-primary transition-colors">{analysis.title}</h4>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span>{format(new Date(analysis.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}</span>
                      {analysis.category && <span className="bg-secondary px-2 py-0.5 rounded">{analysis.category}</span>}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
