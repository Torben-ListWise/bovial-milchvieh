import { useState } from "react";
import { useAuth } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const PLANS = [
  { value: "beta",    label: "Beta",    color: "bg-purple-100 text-purple-800 border-purple-200" },
  { value: "pro",     label: "Pro",     color: "bg-blue-100 text-blue-800 border-blue-200" },
  { value: "starter", label: "Starter", color: "bg-green-100 text-green-800 border-green-200" },
  { value: "free",    label: "Free",    color: "bg-gray-100 text-gray-700 border-gray-200" },
] as const;

type PlanValue = (typeof PLANS)[number]["value"];

type AssignResult =
  | { ok: true; email: string; plan: PlanValue }
  | { ok: false; error: string };

export function UserManagementPage() {
  const { getToken } = useAuth();

  const [email, setEmail] = useState("");
  const [plan, setPlan] = useState<PlanValue>("beta");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AssignResult | null>(null);

  async function handleAssign(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return;

    setLoading(true);
    setResult(null);

    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/admin/plan/assign`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: trimmed, plan }),
      });

      const json = (await res.json()) as { ok?: boolean; error?: string; email?: string; plan?: string };

      if (!res.ok || !json.ok) {
        setResult({ ok: false, error: json.error ?? `HTTP ${res.status}` });
      } else {
        setResult({ ok: true, email: json.email ?? trimmed, plan: (json.plan ?? plan) as PlanValue });
        setEmail("");
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "Unbekannter Fehler" });
    } finally {
      setLoading(false);
    }
  }

  const selectedPlanMeta = PLANS.find((p) => p.value === plan)!;

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Users className="w-6 h-6 text-primary" />
          Nutzerverwaltung
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          Plan eines bereits registrierten Nutzers zuweisen oder ändern.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Plan zuweisen</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAssign} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="um-email" className="text-sm font-medium">
                E-Mail-Adresse
              </label>
              <input
                id="um-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="landwirt@example.com"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
              <p className="text-xs text-muted-foreground">
                Der Nutzer muss sich vorher selbst registriert haben.
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Plan</label>
              <div className="flex flex-wrap gap-2">
                {PLANS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPlan(p.value)}
                    className={`px-3 py-1.5 rounded-md text-sm font-medium border transition-all ${
                      plan === p.value
                        ? `${p.color} ring-2 ring-offset-1 ring-primary`
                        : "border-border bg-muted/50 text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <Button type="submit" disabled={loading || !email.trim()} className="w-full sm:w-auto">
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Wird zugewiesen…
                </>
              ) : (
                <>
                  <Users className="w-4 h-4 mr-2" />
                  {selectedPlanMeta.label}-Plan zuweisen
                </>
              )}
            </Button>
          </form>

          {result && (
            <div
              className={`mt-4 flex items-start gap-2.5 rounded-lg border p-3 text-sm ${
                result.ok
                  ? "border-green-200 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
                  : "border-destructive/30 bg-destructive/5 text-destructive"
              }`}
            >
              {result.ok ? (
                <>
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>
                    <span className="font-semibold">{result.email}</span> hat jetzt den{" "}
                    <Badge className={`text-xs ${PLANS.find((p) => p.value === result.plan)?.color ?? ""}`}>
                      {PLANS.find((p) => p.value === result.plan)?.label ?? result.plan}
                    </Badge>
                    -Plan.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{result.error}</span>
                </>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-muted">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium">Ablauf:</span> Nutzer registriert sich normal über den Sign-Up-Flow →
            Operator sucht die E-Mail hier heraus → wählt den gewünschten Plan → klickt "Plan zuweisen".
            Die Änderung ist sofort aktiv; der Nutzer muss sich nicht erneut anmelden.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
