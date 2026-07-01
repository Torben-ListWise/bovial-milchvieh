import { useGetAdminStats } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Database, FileText, AlertTriangle, Zap } from "lucide-react";

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

async function fetchCacheStats(signal?: AbortSignal): Promise<CacheStatsResponse> {
  const res = await fetch("/api/admin/cache-stats", { signal, credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<CacheStatsResponse>;
}

function useGetAdminCacheStats() {
  return useQuery<CacheStatsResponse>({
    queryKey: ["admin", "cache-stats"],
    queryFn: ({ signal }) => fetchCacheStats(signal),
  });
}

export function OperatorDashboard() {
  const { data: stats, isLoading } = useGetAdminStats();
  const { data: cacheStats, isLoading: cacheLoading } = useGetAdminCacheStats();

  if (isLoading) return <div className="p-8">Laden...</div>;

  const showCacheWarning =
    (cacheStats?.consecutiveZeroReadStreak ?? 0) >= 3;

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
