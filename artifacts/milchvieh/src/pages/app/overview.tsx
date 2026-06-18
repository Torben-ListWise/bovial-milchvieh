import { useGetDatasetOverview, getGetDatasetOverviewQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { DynamicChart } from "@/components/DynamicChart";

export function DatasetOverview() {
  const [location] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const datasetId = searchParams.get("datasetId");

  const { data: overview, isLoading } = useGetDatasetOverview(datasetId!, {
    query: { enabled: !!datasetId, queryKey: getGetDatasetOverviewQueryKey(datasetId!) }
  });

  if (!datasetId) {
    return <div className="p-8">Bitte wählen Sie einen Betrieb aus der Liste.</div>;
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
          <Skeleton className="h-32 rounded-xl" />
        </div>
      </div>
    );
  }

  if (!overview) return <div>Keine Daten verfügbar.</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-foreground">Übersicht</h1>
        {overview.warningCount > 0 && (
          <div className="flex items-center text-destructive bg-destructive/10 px-4 py-2 rounded-lg font-medium">
            <AlertTriangle className="w-5 h-5 mr-2" />
            {overview.warningCount} offene Warnungen
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {overview.kpis.map((kpi) => (
          <Card key={kpi.key}>
            <CardContent className="p-6">
              <p className="text-sm font-medium text-muted-foreground">{kpi.label}</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-bold">
                  {kpi.value !== null ? kpi.value.toLocaleString('de-DE') : '-'}
                  {kpi.unit ? ` ${kpi.unit}` : ''}
                </span>
              </div>
              {kpi.deltaPct !== null && kpi.deltaPct !== undefined && (
                <div className={`mt-2 flex items-center text-sm ${kpi.trend === 'up' ? 'text-green-600' : kpi.trend === 'down' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {kpi.trend === 'up' && <TrendingUp className="w-4 h-4 mr-1" />}
                  {kpi.trend === 'down' && <TrendingDown className="w-4 h-4 mr-1" />}
                  {kpi.trend === 'flat' && <Minus className="w-4 h-4 mr-1" />}
                  <span>{Math.abs(kpi.deltaPct).toLocaleString('de-DE')}% zum Vormonat</span>
                </div>
              )}
              {kpi.basis && <p className="mt-1 text-xs text-muted-foreground">Basis: {kpi.basis}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {overview.charts.map((chart) => (
          <Card key={chart.id} className="flex flex-col">
            <CardHeader className="pb-2 shrink-0">
              <CardTitle>{chart.title}</CardTitle>
              {chart.description && <CardDescription>{chart.description}</CardDescription>}
            </CardHeader>
            <CardContent className="flex-1 min-h-[300px] pt-4">
              <DynamicChart chart={chart as any} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
