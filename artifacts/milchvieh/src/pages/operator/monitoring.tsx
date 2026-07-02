import { useGetAdminStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Database, FileText, AlertTriangle, Zap, DollarSign } from "lucide-react";

interface CacheStatsResponse {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  consecutiveZeroReadStreak: number;
  lastUpdatedAt: string | null;
  hitRatePct: number | null;
  note: string;
}

interface ModelUsageRow {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostEur: number;
}

async function fetchCacheStats(signal?: AbortSignal): Promise<CacheStatsResponse> {
  const res = await fetch("/api/admin/cache-stats", { signal, credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CacheStatsResponse>;
}

async function fetchModelUsage(signal?: AbortSignal): Promise<ModelUsageRow[]> {
  const res = await fetch("/api/admin/model-usage", { signal, credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<ModelUsageRow[]>;
}

function useGetAdminCacheStats() {
  return useQuery<CacheStatsResponse>({
    queryKey: ["admin", "cache-stats"],
    queryFn: ({ signal }) => fetchCacheStats(signal),
  });
}

function useGetModelUsage() {
  return useQuery<ModelUsageRow[]>({
    queryKey: ["admin", "model-usage"],
    queryFn: ({ signal }) => fetchModelUsage(signal),
  });
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
  return n.toLocaleString("de-DE");
}

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
}

export function OperatorDashboard() {
  const { data: stats, isLoading } = useGetAdminStats();
  const { data: cacheStats, isLoading: cacheLoading } = useGetAdminCacheStats();
  const { data: modelUsage, isLoading: modelLoading } = useGetModelUsage();

  if (isLoading) return <div className="p-8">Laden...</div>;

  const showCacheWarning =
    (cacheStats?.consecutiveZeroReadStreak ?? 0) >= 3;

  const totalEstCost = (modelUsage ?? []).reduce((s, r) => s + r.estimatedCostEur, 0);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold">System-Monitoring</h1>
        <p className="text-muted-foreground">Überblick über die Systemnutzung (keine Kundendaten).</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Kunden</CardTitle>
            <Users className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.customerCount || 0}</div>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Betriebe</CardTitle>
            <Database className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.datasetCount || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Analysen (7 Tage)</CardTitle>
            <FileText className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{stats?.analysesLast7Days || 0}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Offene Warnungen</CardTitle>
            <AlertTriangle className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-destructive">{stats?.warningsOpen || 0}</div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Token-Verbrauch nach Modell</h2>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              API-Kosten (Schätzung, Anthropic-Preise 07/2025, Kurs 0,92 €/USD)
            </CardTitle>
            <DollarSign className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {modelLoading ? (
              <div className="text-muted-foreground text-sm">Laden...</div>
            ) : !modelUsage || modelUsage.length === 0 ? (
              <div className="text-muted-foreground text-sm">Noch keine Daten vorhanden.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Modell</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Aufrufe</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Input-Tokens</th>
                      <th className="text-right py-2 px-4 font-medium text-muted-foreground">Output-Tokens</th>
                      <th className="text-right py-2 pl-4 font-medium text-muted-foreground">Gesch. Kosten (€)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modelUsage.map((row) => (
                      <tr key={row.model} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="py-2 pr-4 font-mono text-xs">{row.model}</td>
                        <td className="text-right py-2 px-4 tabular-nums">{row.calls.toLocaleString("de-DE")}</td>
                        <td className="text-right py-2 px-4 tabular-nums">{fmtTokens(row.inputTokens)}</td>
                        <td className="text-right py-2 px-4 tabular-nums">{fmtTokens(row.outputTokens)}</td>
                        <td className="text-right py-2 pl-4 tabular-nums font-medium">
                          {fmtEur(row.estimatedCostEur)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {modelUsage.length > 1 && (
                    <tfoot>
                      <tr className="border-t">
                        <td colSpan={4} className="py-2 pr-4 text-right text-muted-foreground text-xs font-medium">
                          Gesamt
                        </td>
                        <td className="text-right py-2 pl-4 tabular-nums font-bold">
                          {fmtEur(totalEstCost)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
                <p className="text-xs text-muted-foreground mt-3">
                  Cache-Creation- und Cache-Read-Tokens sind nicht im Input-Token-Wert enthalten; Kosten-Schätzung basiert auf Basis-Input- und Output-Preisen.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-xl font-semibold mb-4">Prompt-Cache</h2>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Prompt-Cache-Statistiken</CardTitle>
              {showCacheWarning && (
                <Badge variant="destructive" className="text-xs">
                  Cache-Treffer fehlen ({cacheStats?.consecutiveZeroReadStreak} Aufrufe ohne Treffer)
                </Badge>
              )}
            </div>
            <Zap className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {cacheLoading ? (
              <div className="text-muted-foreground text-sm">Laden...</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-xs text-muted-foreground mb-1">API-Aufrufe gesamt</div>
                  <div className="text-2xl font-bold">{cacheStats?.totalCalls ?? 0}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Cache-Trefferrate</div>
                  <div className={`text-2xl font-bold ${showCacheWarning ? "text-destructive" : ""}`}>
                    {cacheStats?.hitRatePct !== null && cacheStats?.hitRatePct !== undefined
                      ? `${cacheStats.hitRatePct.toFixed(1)} %`
                      : "–"}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Cache-Creation-Tokens</div>
                  <div className="text-2xl font-bold">
                    {cacheStats?.totalCacheCreationTokens
                      ? cacheStats.totalCacheCreationTokens.toLocaleString("de-DE")
                      : 0}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Cache-Read-Tokens</div>
                  <div className="text-2xl font-bold">
                    {cacheStats?.totalCacheReadTokens
                      ? cacheStats.totalCacheReadTokens.toLocaleString("de-DE")
                      : 0}
                  </div>
                </div>
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">
              In-Memory — wird beim Server-Neustart zurückgesetzt.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
