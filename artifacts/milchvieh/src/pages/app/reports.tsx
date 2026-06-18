import { useListReports, getListReportsQueryKey, useGenerateReport } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, Plus, Calendar, AlertCircle } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";

export function ReportsPage() {
  const searchParams = new URLSearchParams(window.location.search);
  const datasetId = searchParams.get("datasetId");
  const queryClient = useQueryClient();

  const { data: reports, isLoading } = useListReports(
    { datasetId },
    { query: { enabled: !!datasetId, queryKey: getListReportsQueryKey({ datasetId }) } }
  );

  const generateReport = useGenerateReport({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey({ datasetId }) });
      }
    }
  });

  if (!datasetId) {
    return <div className="p-8">Bitte wählen Sie einen Betrieb aus der Liste.</div>;
  }

  const handleGenerate = () => {
    generateReport.mutate({
      data: {
        period: "monthly",
        title: `Monatsbericht ${format(new Date(), "MMMM yyyy", { locale: de })}`
      }
    });
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Berichte</h1>
          <p className="text-muted-foreground mt-1">Automatisch generierte Zusammenfassungen für Ihren Betrieb.</p>
        </div>
        <Button className="gap-2" onClick={handleGenerate} disabled={generateReport.isPending}>
          <Plus className="w-4 h-4" />
          {generateReport.isPending ? "Generiere..." : "Neuer Bericht"}
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : !reports || reports.length === 0 ? (
        <Card className="border-dashed bg-secondary/10">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <FileText className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-semibold mb-2">Noch keine Berichte</h3>
            <p className="text-muted-foreground mb-6 max-w-md">
              Generieren Sie Ihren ersten wöchentlichen oder monatlichen Bericht, um eine Zusammenfassung der wichtigsten Kennzahlen zu erhalten.
            </p>
            <Button onClick={handleGenerate}>Ersten Bericht generieren</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {reports.map((report) => (
            <Card key={report.id} className="hover:border-primary/50 transition-colors cursor-pointer group">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <CardTitle className="group-hover:text-primary transition-colors">{report.title}</CardTitle>
                  <span className={`text-xs px-2 py-1 rounded-full ${report.status === 'ready' ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400' : report.status === 'error' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                    {report.status === 'ready' ? 'Fertig' : report.status === 'error' ? 'Fehler' : 'Generiert...'}
                  </span>
                </div>
                <CardDescription className="flex items-center gap-2 mt-2">
                  <Calendar className="w-4 h-4" />
                  {format(new Date(report.createdAt), "dd. MMMM yyyy", { locale: de })}
                  <span className="capitalize border-l pl-2 ml-2 border-border">{report.period === 'weekly' ? 'Wöchentlich' : report.period === 'monthly' ? 'Monatlich' : report.period}</span>
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground line-clamp-3">
                  {report.summary || "Keine Zusammenfassung verfügbar."}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
