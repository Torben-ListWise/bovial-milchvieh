import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RefreshCw, BarChart3, TrendingDown, Cpu, Tag, Users, AlertTriangle } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type BIDashboardData = {
  topTools: { toolName: string; count: number }[];
  topChipCategories: { category: string; count: number }[];
  planDistribution: { plan: string; userCount: number }[];
  weeklyActivity: { userId: string; userName: string; week: string; analyses: number }[];
  churnRisk: { userId: string; userName: string; userEmail: string; priorCount: number; recentCount: number; dropPercent: number }[];
};

const PLAN_LABELS: Record<string, { label: string; color: string }> = {
  free:        { label: "Kostenlos",    color: "bg-muted text-muted-foreground" },
  basis:       { label: "Basis",        color: "bg-green-100 text-green-800" },
  starter:     { label: "Professional", color: "bg-blue-100 text-blue-800" },
  pro:         { label: "Premium",      color: "bg-purple-100 text-purple-800" },
  premium_max: { label: "Premium Max",  color: "bg-amber-100 text-amber-800" },
  beta:        { label: "Beta",         color: "bg-rose-100 text-rose-800" },
};

function PlanBadge({ plan }: { plan: string }) {
  const cfg = PLAN_LABELS[plan] ?? { label: plan, color: "bg-muted" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

function BarRow({ label, value, max, suffix = "" }: { label: string; value: number; max: number; suffix?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-sm">
        <span className="truncate max-w-[200px]">{label}</span>
        <span className="font-medium ml-2 shrink-0">{value.toLocaleString("de-DE")}{suffix}</span>
      </div>
      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function BIDashboardPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<BIDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/bi-dashboard`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  const maxTool = Math.max(1, ...(data?.topTools.map((t) => t.count) ?? [1]));
  const maxChip = Math.max(1, ...(data?.topChipCategories.map((c) => c.count) ?? [1]));

  // Aggregate weekly activity: total analyses per user over the 8 weeks
  const userTotals = new Map<string, { name: string; total: number; weeks: number }>();
  for (const row of data?.weeklyActivity ?? []) {
    const existing = userTotals.get(row.userId) ?? { name: row.userName, total: 0, weeks: 0 };
    userTotals.set(row.userId, { name: existing.name, total: existing.total + row.analyses, weeks: existing.weeks + 1 });
  }
  const topUsers = [...userTotals.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 10);
  const maxUserTotal = Math.max(1, ...topUsers.map(([, u]) => u.total));

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Business-Intelligence-Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Zusammenführung bestehender Logging-Datenquellen — nur für Betreiber sichtbar
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} />
          Aktualisieren
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-destructive/30 bg-destructive/5 text-sm text-destructive">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}><CardContent className="pt-5"><div className="animate-pulse space-y-3">{[...Array(5)].map((_, j) => <div key={j} className="h-5 bg-muted rounded" />)}</div></CardContent></Card>
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Row 1: Top Tools + Top Chip Categories */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Cpu className="w-4 h-4" />
                  Meistgenutzte Agent-Tools
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topTools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Noch keine Tool-Logs vorhanden.</p>
                ) : (
                  <div className="space-y-3">
                    {data.topTools.map((t) => (
                      <BarRow key={t.toolName} label={t.toolName} value={t.count} max={maxTool} suffix=" Aufrufe" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="w-4 h-4" />
                  Meistgefragte Themen (Chip-Kategorien, letzte 90 Tage)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.topChipCategories.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Noch keine Chip-Daten vorhanden.</p>
                ) : (
                  <div className="space-y-3">
                    {data.topChipCategories.map((c) => (
                      <BarRow key={c.category} label={c.category} value={c.count} max={maxChip} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Row 2: Plan Distribution + Top Active Users */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Users className="w-4 h-4" />
                  Nutzer nach Preisplan
                </CardTitle>
              </CardHeader>
              <CardContent>
                {data.planDistribution.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Keine Kunden vorhanden.</p>
                ) : (
                  <div className="space-y-2">
                    {data.planDistribution.map((p) => (
                      <div key={p.plan} className="flex items-center justify-between py-1.5 border-b last:border-0">
                        <PlanBadge plan={p.plan} />
                        <span className="font-semibold">{p.userCount.toLocaleString("de-DE")} Betriebe</span>
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground pt-1">
                      Gesamt: {data.planDistribution.reduce((s, p) => s + p.userCount, 0).toLocaleString("de-DE")} Kunden
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <BarChart3 className="w-4 h-4" />
                  Aktivste Betriebe (letzte 8 Wochen)
                </CardTitle>
              </CardHeader>
              <CardContent>
                {topUsers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Noch keine Analysen.</p>
                ) : (
                  <div className="space-y-3">
                    {topUsers.map(([uid, u]) => (
                      <BarRow key={uid} label={u.name ?? uid.slice(0, 12) + "…"} value={u.total} max={maxUserTotal} suffix=" Analysen" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Churn Risk */}
          <Card className={data.churnRisk.length > 0 ? "border-amber-200 bg-amber-50/30" : ""}>
            <CardHeader>
              <CardTitle className={`flex items-center gap-2 text-base ${data.churnRisk.length > 0 ? "text-amber-700" : ""}`}>
                <TrendingDown className="w-4 h-4" />
                Abwanderungs-Frühwarnung
                {data.churnRisk.length > 0 && (
                  <span className="ml-1 bg-amber-500 text-white text-xs px-1.5 py-0.5 rounded-full">{data.churnRisk.length}</span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.churnRisk.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Kein Betrieb zeigt einen signifikanten Rückgang in den letzten 14 Tagen. ✓
                </p>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground mb-3">
                    Betriebe mit &gt;50 % Rückgang der Analysen (letzte 14 Tage vs. davor), mind. 3 Analysen im Vergleichszeitraum.
                  </p>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Betrieb</th>
                          <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Vorher (14d)</th>
                          <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Aktuell (14d)</th>
                          <th className="text-right py-2 font-medium text-muted-foreground">Rückgang</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.churnRisk.map((u) => (
                          <tr key={u.userId} className="border-b last:border-0 hover:bg-amber-100/40">
                            <td className="py-2 pr-4">
                              <p className="font-medium">{u.userName}</p>
                              <p className="text-xs text-muted-foreground">{u.userEmail}</p>
                            </td>
                            <td className="text-right py-2 pr-4">{u.priorCount}</td>
                            <td className="text-right py-2 pr-4">{u.recentCount}</td>
                            <td className="text-right py-2">
                              <span className="font-semibold text-amber-700">−{u.dropPercent} %</span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
