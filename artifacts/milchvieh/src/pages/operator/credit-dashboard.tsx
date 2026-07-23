import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, BarChart3, Users, Zap, TrendingUp, Crown, RefreshCw, Euro } from "lucide-react";
import { Button } from "@/components/ui/button";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

type CreditEntry = {
  id: string;
  analysisId: string;
  userId: string;
  datasetId: string | null;
  complexity: "simple" | "complex" | "calculator";
  credits: number;
  toolsCalled: string[];
  inputTokens: number;
  outputTokens: number;
  apiCostMillicents: number;
  plan: string | null;
  createdAt: string;
  userName: string | null;
  userEmail: string | null;
};

type ComplexityAggregate = {
  complexity: string;
  count: string;
  avgCredits: string;
  avgApiCostMillicents: string;
  totalCredits: string;
  totalApiCostMillicents: string;
};

type UserAggregate = {
  userId: string;
  userName: string | null;
  userEmail: string | null;
  totalCredits: string;
  totalApiCostMillicents: string;
  requestCount: string;
};

type Outlier = CreditEntry & {
  avgForComplexity: number;
  costRatio: string;
};

type CreditUsageData = {
  entries: CreditEntry[];
  total: number;
  byComplexity: ComplexityAggregate[];
  byUser: UserAggregate[];
  outliers: Outlier[];
  meta: {
    limit: number;
    offset: number;
    filterUserId: string | null;
    filterComplexity: string | null;
    currentYearMonth: string;
  };
};

const COMPLEXITY_LABEL: Record<string, { label: string; credits: string; color: string }> = {
  simple:     { label: "Einfach",    credits: "1 Credit",  color: "bg-green-100 text-green-800" },
  complex:    { label: "Komplex",    credits: "3 Credits", color: "bg-blue-100 text-blue-800" },
  calculator: { label: "Kalkulator", credits: "5 Credits", color: "bg-purple-100 text-purple-800" },
};

function millicentsToEurocents(mc: number | string): string {
  const val = typeof mc === "string" ? parseFloat(mc) : mc;
  return (val / 1000).toFixed(2);
}

function formatEur(mc: number | string): string {
  return `${(parseFloat(String(mc)) / 100_000).toFixed(4)} €`;
}

function ComplexityBadge({ complexity }: { complexity: string }) {
  const cfg = COMPLEXITY_LABEL[complexity] ?? { label: complexity, credits: "?", color: "bg-muted" };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

type MarginRow = {
  plan: string;
  priceEur: number;
  activeUsers: number;
  monthlyRevenueEur: number;
  totalApiCostEur: number;
  avgApiCostEurPerUser: number;
  marginEur: number;
  marginPct: number | null;
};

const PLAN_LABELS_MARGIN: Record<string, string> = {
  free: "Kostenlos", basis: "Basis", starter: "Professional",
  pro: "Premium", premium_max: "Premium Max", beta: "Beta",
};

function MarginSection() {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<MarginRow[]>([]);
  const [yearMonth, setYearMonth] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/admin/credit-margin`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (res.ok) {
          const d = await res.json();
          setRows(d.margins ?? []);
          setYearMonth(d.yearMonth ?? "");
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  function marginColor(pct: number | null) {
    if (pct === null) return "text-muted-foreground";
    if (pct >= 70) return "text-green-700 font-semibold";
    if (pct >= 40) return "text-blue-700";
    if (pct >= 0) return "text-amber-700";
    return "text-destructive font-semibold";
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Euro className="w-4 h-4" />
          Margenanalyse pro Preisplan — {yearMonth}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground mb-3">
          Einnahmen (Listenpreis × aktive Nutzer) vs. tatsächliche API-Kosten dieses Monats.
          Nur Nutzer mit role='customer'. Keine Stripe-Stornierungen berücksichtigt.
        </p>
        {loading ? (
          <div className="animate-pulse space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-8 bg-muted rounded" />)}</div>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Nutzungsdaten vorhanden.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-xs">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Plan</th>
                  <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Nutzer</th>
                  <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Einnahmen (€)</th>
                  <th className="text-right py-2 pr-4 font-medium text-muted-foreground">API-Kosten ges. (€)</th>
                  <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Ø Kosten/Nutzer (€)</th>
                  <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Marge (€)</th>
                  <th className="text-right py-2 font-medium text-muted-foreground">Marge (%)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.plan} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="py-2 pr-4 font-medium">{PLAN_LABELS_MARGIN[r.plan] ?? r.plan}</td>
                    <td className="text-right py-2 pr-4">{r.activeUsers.toLocaleString("de-DE")}</td>
                    <td className="text-right py-2 pr-4">{r.monthlyRevenueEur.toFixed(2)} €</td>
                    <td className="text-right py-2 pr-4">{r.totalApiCostEur.toFixed(4)} €</td>
                    <td className="text-right py-2 pr-4">{r.avgApiCostEurPerUser.toFixed(4)} €</td>
                    <td className="text-right py-2 pr-4">{r.marginEur.toFixed(2)} €</td>
                    <td className={`text-right py-2 ${marginColor(r.marginPct)}`}>
                      {r.marginPct !== null ? `${r.marginPct} %` : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function CreditDashboardPage() {
  const { getToken } = useAuth();
  const [data, setData] = useState<CreditUsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterUserId, setFilterUserId] = useState("");
  const [filterComplexity, setFilterComplexity] = useState("");
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (filterUserId.trim()) params.set("userId", filterUserId.trim());
      if (filterComplexity) params.set("complexity", filterComplexity);

      const res = await fetch(`${API_BASE}/api/admin/credit-usage?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Fehler beim Laden");
    } finally {
      setLoading(false);
    }
  }, [getToken, filterUserId, filterComplexity, offset]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-primary" />
            Credit-Verbrauchs-Dashboard
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Validierung der Credit-Gewichtung (1/3/5) vor dem Live-Gang des Preismodells
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

      {/* Aggregates by Complexity */}
      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {(["simple", "complex", "calculator"] as const).map((c) => {
            const agg = data.byComplexity.find((r) => r.complexity === c);
            const cfg = COMPLEXITY_LABEL[c];
            return (
              <Card key={c}>
                <CardContent className="pt-5">
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${cfg.color}`}>{cfg.label}</span>
                    <span className="text-xs text-muted-foreground">{cfg.credits}</span>
                  </div>
                  {agg ? (
                    <div className="space-y-1.5">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Anfragen</span>
                        <span className="font-medium">{parseInt(agg.count).toLocaleString("de-DE")}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Ø Credits</span>
                        <span className="font-medium">{parseFloat(agg.avgCredits).toFixed(1)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Ø API-Kosten</span>
                        <span className="font-medium">{millicentsToEurocents(agg.avgApiCostMillicents)} €¢</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Gesamt Credits</span>
                        <span className="font-medium">{parseInt(agg.totalCredits).toLocaleString("de-DE")}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Gesamt API-Kosten</span>
                        <span className="font-medium">{formatEur(agg.totalApiCostMillicents)}</span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">Noch keine Daten</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Per-user monthly totals */}
      {data && data.byUser.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="w-4 h-4" />
              Credit-Verbrauch pro Betrieb — {data.meta.currentYearMonth}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Nutzer</th>
                    <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Anfragen</th>
                    <th className="text-right py-2 pr-4 font-medium text-muted-foreground">Credits</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">API-Kosten (€)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byUser.map((u) => (
                    <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/30">
                      <td className="py-2 pr-4">
                        <p className="font-medium">{u.userName ?? "–"}</p>
                        <p className="text-xs text-muted-foreground">{u.userEmail ?? u.userId.slice(0, 12) + "…"}</p>
                      </td>
                      <td className="text-right py-2 pr-4">{parseInt(u.requestCount).toLocaleString("de-DE")}</td>
                      <td className="text-right py-2 pr-4 font-medium">{parseInt(u.totalCredits).toLocaleString("de-DE")}</td>
                      <td className="text-right py-2">{formatEur(u.totalApiCostMillicents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Outliers */}
      {data && data.outliers.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-700">
              <AlertTriangle className="w-4 h-4" />
              Auffällige Anfragen (Kostenverhältnis &gt; 2× Durchschnitt der Komplexitätsstufe)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              Diese Anfragen wurden als "einfach" oder "komplex" eingestuft, verursachten aber
              überdurchschnittlich hohe API-Kosten. Überprüfe die Tool-Aufrufe und passe ggf.
              die Credit-Gewichtung nach dem Test an.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Zeitpunkt</th>
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Nutzer</th>
                    <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Stufe</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Credits</th>
                    <th className="text-right py-2 pr-3 font-medium text-muted-foreground">API-Kosten</th>
                    <th className="text-right py-2 font-medium text-muted-foreground">Faktor</th>
                  </tr>
                </thead>
                <tbody>
                  {data.outliers.map((o) => (
                    <tr key={o.id} className="border-b last:border-0 hover:bg-amber-50">
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {new Date(o.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                      <td className="py-2 pr-3">
                        <p className="truncate max-w-[120px]">{o.userName ?? o.userId.slice(0, 8) + "…"}</p>
                      </td>
                      <td className="py-2 pr-3"><ComplexityBadge complexity={o.complexity} /></td>
                      <td className="text-right py-2 pr-3">{o.credits}</td>
                      <td className="text-right py-2 pr-3">{formatEur(o.apiCostMillicents)}</td>
                      <td className="text-right py-2">
                        <span className="font-medium text-amber-700">{o.costRatio}×</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Margin Analysis Section */}
      <MarginSection />

      {/* Filter + Recent Entries */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <CardTitle className="text-base">Letzte Anfragen</CardTitle>
            <div className="flex gap-2 flex-wrap">
              <input
                type="text"
                placeholder="User-ID filtern…"
                value={filterUserId}
                onChange={(e) => { setFilterUserId(e.target.value); setOffset(0); }}
                className="h-8 px-3 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring w-44"
              />
              <select
                value={filterComplexity}
                onChange={(e) => { setFilterComplexity(e.target.value); setOffset(0); }}
                className="h-8 px-3 text-xs rounded-md border border-input bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">Alle Stufen</option>
                <option value="simple">Einfach</option>
                <option value="complex">Komplex</option>
                <option value="calculator">Kalkulator</option>
              </select>
            </div>
          </div>
          {data && (
            <p className="text-xs text-muted-foreground mt-1">
              {data.total.toLocaleString("de-DE")} Einträge gesamt
            </p>
          )}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-muted rounded" />)}
            </div>
          ) : data?.entries.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Noch keine Credit-Einträge vorhanden. Starte eine Analyse, um Daten zu sammeln.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-xs">
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Zeitpunkt</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Nutzer</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Stufe</th>
                      <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Credits</th>
                      <th className="text-left py-2 pr-3 font-medium text-muted-foreground">Tools</th>
                      <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Input-Tok.</th>
                      <th className="text-right py-2 pr-3 font-medium text-muted-foreground">Output-Tok.</th>
                      <th className="text-right py-2 font-medium text-muted-foreground">API-Kosten</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data?.entries.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30 text-xs">
                        <td className="py-2 pr-3 text-muted-foreground whitespace-nowrap">
                          {new Date(e.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}
                        </td>
                        <td className="py-2 pr-3">
                          <p className="font-medium truncate max-w-[100px]">{e.userName ?? "–"}</p>
                          <p className="text-muted-foreground truncate max-w-[100px]">{e.plan ?? "–"}</p>
                        </td>
                        <td className="py-2 pr-3">
                          <ComplexityBadge complexity={e.complexity} />
                        </td>
                        <td className="text-right py-2 pr-3 font-medium">{e.credits}</td>
                        <td className="py-2 pr-3">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(e.toolsCalled ?? []).slice(0, 4).map((t) => (
                              <span key={t} className="bg-muted px-1.5 py-0.5 rounded text-[10px] font-mono truncate max-w-[90px]">{t}</span>
                            ))}
                            {(e.toolsCalled ?? []).length > 4 && (
                              <span className="text-muted-foreground text-[10px]">+{e.toolsCalled.length - 4}</span>
                            )}
                          </div>
                        </td>
                        <td className="text-right py-2 pr-3">{(e.inputTokens ?? 0).toLocaleString("de-DE")}</td>
                        <td className="text-right py-2 pr-3">{(e.outputTokens ?? 0).toLocaleString("de-DE")}</td>
                        <td className="text-right py-2 font-mono">{formatEur(e.apiCostMillicents ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {data && (
                <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
                  <span>{offset + 1}–{Math.min(offset + LIMIT, data.total)} von {data.total}</span>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                      ← Zurück
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-xs" disabled={offset + LIMIT >= data.total} onClick={() => setOffset(offset + LIMIT)}>
                      Weiter →
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
