import { useListWarnings, getListWarningsQueryKey, useUpdateWarning, useListFiles, getListFilesQueryKey } from "@workspace/api-client-react";
import { useRequireDataset } from "@/hooks/use-require-dataset";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, CheckCircle, Clock, UploadCloud } from "lucide-react";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

export function WarningsPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: warnings, isLoading } = useListWarnings(
    datasetId ?? "",
    { query: { enabled: !!datasetId, queryKey: getListWarningsQueryKey(datasetId ?? "") } }
  );

  const { data: files } = useListFiles(
    datasetId ?? "",
    { query: { enabled: !!datasetId, queryKey: getListFilesQueryKey(datasetId ?? "") } }
  );

  const updateWarning = useUpdateWarning({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListWarningsQueryKey(datasetId ?? "") });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Warnung konnte nicht aktualisiert werden." });
      },
    }
  });

  if (datasetLoading || !datasetId) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground">Laden…</div>;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Warnungen</h1>
        <p className="text-muted-foreground mt-1">Automatische Hinweise auf Anomalien in deinen Herden-Daten.</p>
      </div>

      {!warnings || warnings.length === 0 ? (
        !files || files.length === 0 ? (
          <Card className="border-dashed bg-secondary/10">
            <CardContent className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                <UploadCloud className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-xl font-semibold mb-2">Noch keine Daten vorhanden</h3>
              <p className="text-muted-foreground mb-6 max-w-md">
                Lade zuerst deine Herdenmanagement-Daten hoch. Warnungen werden automatisch erkannt, sobald Daten vorliegen.
              </p>
              <Button asChild>
                <Link href={`/app/upload${datasetId ? `?datasetId=${datasetId}` : ""}`}>
                  <UploadCloud className="w-4 h-4 mr-2" />
                  Erste Datei hochladen
                </Link>
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed bg-secondary/10">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
              <h3 className="text-xl font-semibold mb-2">Alles im grünen Bereich</h3>
              <p className="text-muted-foreground">Es liegen aktuell keine Warnungen vor.</p>
            </CardContent>
          </Card>
        )
      ) : (
        <div className="space-y-4">
          {warnings.map((w) => (
            <Card key={w.id} className={`border-l-4 ${w.severity === 'critical' ? 'border-l-destructive' : w.severity === 'warning' ? 'border-l-orange-500' : 'border-l-blue-500'}`}>
              <CardContent className="p-4 flex items-start justify-between">
                <div className="flex gap-4">
                  <div className="mt-1">
                    <AlertTriangle className={`w-5 h-5 ${w.severity === 'critical' ? 'text-destructive' : w.severity === 'warning' ? 'text-orange-500' : 'text-blue-500'}`} />
                  </div>
                  <div>
                    <h4 className="font-semibold text-foreground">{w.title}</h4>
                    <p className="text-sm text-muted-foreground mt-1">{w.detail}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {format(new Date(w.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}</span>
                      {w.metric && <span>Metrik: {w.metric}</span>}
                      {w.value !== null && <span>Wert: {w.value}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  {w.status === 'open' ? (
                    <>
                      <Button size="sm" variant="outline" onClick={() => updateWarning.mutate({ warningId: w.id, data: { status: 'acknowledged' } })}>Zur Kenntnis</Button>
                      <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => updateWarning.mutate({ warningId: w.id, data: { status: 'dismissed' } })}>Ignorieren</Button>
                    </>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground bg-secondary px-2 py-1 rounded">
                      {w.status === 'acknowledged' ? 'Zur Kenntnis genommen' : 'Ignoriert'}
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
