import { useExportMyData, useDeleteMyData, useGetCurrentUser, useUpdateMe, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Trash2, ShieldCheck, Tractor, Loader2, Sparkles, CreditCard, Zap, Crown, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { useSearch } from "wouter";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const FOCUS_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: "milchvieh", label: "Milchvieh", emoji: "🐄" },
  { value: "schweine", label: "Schweinehaltung", emoji: "🐷" },
  { value: "geflügel", label: "Geflügel", emoji: "🐔" },
  { value: "ackerbau", label: "Ackerbau", emoji: "🌾" },
  { value: "mischbetrieb", label: "Mischbetrieb", emoji: "🏡" },
  { value: "sonstiges", label: "Sonstiges", emoji: "🌱" },
];

function FocusAreasSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: dbUser } = useGetCurrentUser();
  const [selected, setSelected] = useState<string[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (!initialized && dbUser !== undefined) {
      setSelected(dbUser.focusAreas ?? []);
      setInitialized(true);
    }
  }, [dbUser, initialized]);

  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
        toast({ title: "Gespeichert", description: "Betriebsschwerpunkte wurden aktualisiert." });
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen." });
      },
    },
  });

  function toggle(value: string) {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tractor className="w-5 h-5 text-primary" />
          Betriebsschwerpunkte
        </CardTitle>
        <CardDescription>
          Wähle die Schwerpunkte deines Betriebs. Die Analysen-Vorlagen werden danach gefiltert.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {FOCUS_OPTIONS.map((opt) => {
            const isSelected = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                onClick={() => toggle(opt.value)}
                className={`flex items-center gap-2 rounded-lg border p-3 text-left transition-all text-sm ${
                  isSelected
                    ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                    : "border-border hover:border-primary/40 hover:bg-muted/50"
                }`}
              >
                <span className="text-lg">{opt.emoji}</span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
        <Button
          onClick={() => updateMe.mutate({ focusAreas: selected })}
          disabled={updateMe.isPending}
          className="gap-2"
        >
          {updateMe.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          Speichern
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Billing types ─────────────────────────────────────────────────────────────

type BillingStatus = {
  plan: string;
  analysesUsed: number;
  analysesLimit: number | null;
  periodEnd: string | null;
  gracePeriodEndsAt: string | null;
  stripeCustomerId: string | null;
};

const PLAN_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  free:    { label: "Free",    color: "text-muted-foreground", icon: Zap },
  starter: { label: "Starter", color: "text-blue-600",         icon: TrendingUp },
  pro:     { label: "Pro",     color: "text-primary",          icon: Crown },
};

function useBillingStatus() {
  const { getToken } = useAuth();
  const [status, setStatus] = useState<BillingStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/billing/status`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!cancelled && res.ok) {
          setStatus(await res.json());
        }
      } catch {
        // Stripe not configured — skip silently
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { status, loading };
}

async function createCheckoutSession(token: string | null, plan: string): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/billing/checkout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      plan,
      successUrl: `${window.location.origin}/app/settings?billing=success`,
      cancelUrl: `${window.location.origin}/app/settings`,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url ?? null;
}

async function createPortalSession(token: string | null): Promise<string | null> {
  const res = await fetch(`${API_BASE}/api/billing/portal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ returnUrl: `${window.location.origin}/app/settings` }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.url ?? null;
}

function BillingSection() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { status, loading } = useBillingStatus();
  const [checkoutLoading, setCheckoutLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const search = useSearch();

  // Plans are resolved server-side — frontend just sends "starter" or "pro"

  // Show success/cancel toast from Stripe redirect
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("billing") === "success") {
      toast({ title: "Zahlung erfolgreich", description: "Dein Abonnement wurde aktiviert." });
      window.history.replaceState(null, "", window.location.pathname);
    } else if (params.get("billing") === "cancel") {
      toast({ variant: "destructive", title: "Zahlung abgebrochen" });
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, []);

  async function handleUpgrade(plan: string) {
    setCheckoutLoading(plan);
    try {
      const token = await getToken();
      const url = await createCheckoutSession(token, plan);
      if (url) {
        window.location.href = url;
      } else {
        toast({ variant: "destructive", title: "Fehler", description: "Checkout konnte nicht geöffnet werden." });
      }
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Checkout konnte nicht geöffnet werden." });
    } finally {
      setCheckoutLoading(null);
    }
  }

  async function handlePortal() {
    setPortalLoading(true);
    try {
      const token = await getToken();
      const url = await createPortalSession(token);
      if (url) {
        window.location.href = url;
      } else {
        toast({ variant: "destructive", title: "Fehler", description: "Portal konnte nicht geöffnet werden." });
      }
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Portal konnte nicht geöffnet werden." });
    } finally {
      setPortalLoading(false);
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse space-y-3">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-2 bg-muted rounded w-full" />
            <div className="h-2 bg-muted rounded w-2/3" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!status) return null;

  const planInfo = PLAN_LABELS[status.plan] ?? PLAN_LABELS.free;
  const PlanIcon = planInfo.icon;
  const isPro = status.plan === "pro";
  const limit = status.analysesLimit ?? null;
  const used = status.analysesUsed;
  const usedPct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const isNearLimit = limit != null && usedPct >= 80;
  const isAtLimit = limit != null && used >= limit;
  const hasGracePeriod = !!status.gracePeriodEndsAt && new Date(status.gracePeriodEndsAt) > new Date();

  const periodEndLabel = status.periodEnd
    ? new Date(status.periodEnd).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" })
    : null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-primary" />
          Abonnement & Kontingent
        </CardTitle>
        <CardDescription>
          Verwalte deinen Tarif und verfolge den Verbrauch deiner monatlichen Analysen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">

        {/* Grace period warning banner */}
        {hasGracePeriod && (
          <div className="flex items-start gap-3 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
            <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">Zahlung fehlgeschlagen</p>
              <p className="text-muted-foreground text-xs mt-0.5">
                Bitte aktualisiere deine Zahlungsmethode bis zum{" "}
                {new Date(status.gracePeriodEndsAt!).toLocaleDateString("de-DE")},
                sonst wird dein Konto auf Free downgegradet.
              </p>
              <Button size="sm" variant="destructive" className="mt-2 h-7 text-xs" onClick={handlePortal} disabled={portalLoading}>
                {portalLoading && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                Zahlungsmethode aktualisieren
              </Button>
            </div>
          </div>
        )}

        {/* Current plan badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
              isPro ? "bg-primary/10" : status.plan === "starter" ? "bg-blue-50" : "bg-muted"
            }`}>
              <PlanIcon className={`w-5 h-5 ${planInfo.color}`} />
            </div>
            <div>
              <p className="font-semibold text-sm">
                Aktueller Tarif:{" "}
                <span className={planInfo.color}>{planInfo.label}</span>
              </p>
              {periodEndLabel && (
                <p className="text-xs text-muted-foreground">Verlängert am {periodEndLabel}</p>
              )}
            </div>
          </div>
          {status.stripeCustomerId && (
            <Button variant="outline" size="sm" onClick={handlePortal} disabled={portalLoading} className="gap-1.5 text-xs">
              {portalLoading && <Loader2 className="w-3 h-3 animate-spin" />}
              Abo verwalten
            </Button>
          )}
        </div>

        {/* Quota progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Analysen diesen Monat</span>
            <span className={`font-medium ${isAtLimit ? "text-destructive" : isNearLimit ? "text-amber-600" : "text-foreground"}`}>
              {isPro ? `${used} / ∞` : `${used} / ${limit ?? "—"}`}
            </span>
          </div>
          {!isPro && limit != null && (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isAtLimit ? "bg-destructive" : isNearLimit ? "bg-amber-500" : "bg-primary"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
          )}
          {isPro && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
              Unbegrenzte Analysen inklusive
            </div>
          )}
          {isAtLimit && (
            <p className="text-xs text-destructive">
              Kontingent aufgebraucht. Upgrade auf Starter oder Pro für weitere Analysen.
            </p>
          )}
        </div>

        {/* Upgrade options */}
        {!isPro && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {status.plan !== "starter" && (
              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-sm">Starter</span>
                  <span className="ml-auto text-xs text-muted-foreground">50 €/Monat zzgl. USt.</span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> 50 Analysen/Monat</li>
                  <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Alle Vorlagen</li>
                  <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Unbegrenzte Folgefragen</li>
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => handleUpgrade("starter")}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === "starter" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                  Auf Starter upgraden
                </Button>
              </div>
            )}

            <div className={`border rounded-xl p-4 space-y-2 ${status.plan !== "starter" ? "border-primary/30 bg-primary/3" : "col-span-full sm:col-auto"}`}>
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Pro</span>
                <span className="ml-auto text-xs text-muted-foreground">100 €/Monat zzgl. USt.</span>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Unbegrenzte Analysen</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Alle Vorlagen</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Priorität-Support</li>
              </ul>
              <Button
                size="sm"
                className="w-full text-xs"
                onClick={() => handleUpgrade("pro")}
                disabled={checkoutLoading !== null}
              >
                {checkoutLoading === "pro" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                Auf Pro upgraden
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function SettingsPage() {
  const { toast } = useToast();
  const { signOut } = useClerk();
  const exportData = useExportMyData();
  const deleteData = useDeleteMyData();
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const data = await exportData.mutateAsync();

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `milchvieh-export-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({ title: "Erfolg", description: "Deine Daten wurden erfolgreich exportiert." });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Der Export ist fehlgeschlagen." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteData.mutateAsync();
      toast({ title: "Daten gelöscht", description: "Alle deine Daten wurden unwiderruflich gelöscht." });
      signOut({ redirectUrl: "/" });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Beim Löschen ist ein Fehler aufgetreten." });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Einstellungen & DSGVO</h1>
        <p className="text-muted-foreground mt-1">Verwalte deine Daten und Privatsphäre.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Tarif &amp; Abonnement
          </CardTitle>
          <CardDescription>
            Upgrade dein Konto für mehr Analysen und erweiterte Funktionen.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-lg bg-secondary/20">
            <div>
              <h3 className="font-medium text-foreground">Verfügbare Tarife</h3>
              <p className="text-sm text-muted-foreground">
                Professional (29,00 € / Monat netto) oder Premium (79,00 € / Monat netto) — zzgl. 19 % MwSt.
              </p>
            </div>
            <Button asChild className="gap-2 shrink-0">
              <Link href="/app/upgrade">
                <Sparkles className="w-4 h-4" />
                Jetzt upgraden
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <FocusAreasSection />

      <BillingSection />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Deine Daten gehören dir
          </CardTitle>
          <CardDescription>
            Gemäß der europäischen Datenschutz-Grundverordnung (DSGVO) hast du das Recht, alle über dich gespeicherten Daten jederzeit herunterzuladen oder dauerhaft zu löschen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-lg bg-secondary/20">
            <div>
              <h3 className="font-medium text-foreground">Datenexport</h3>
              <p className="text-sm text-muted-foreground">Lade alle deine Betriebe, Analysen und Regeln als JSON-Datei herunter.</p>
            </div>
            <Button onClick={handleExport} disabled={isExporting} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              {isExporting ? "Wird exportiert..." : "Daten exportieren"}
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-destructive/20 rounded-lg bg-destructive/5">
            <div>
              <h3 className="font-medium text-destructive">Konto löschen</h3>
              <p className="text-sm text-muted-foreground">Löscht alle deine Daten unwiderruflich. Dies kann nicht rückgängig gemacht werden.</p>
            </div>

            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" className="gap-2">
                  <Trash2 className="w-4 h-4" />
                  Daten löschen
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Bist du sicher?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Diese Aktion kann nicht rückgängig gemacht werden. Dadurch werden dein Konto und deine Daten (Betriebe, Analysen, Dateien) dauerhaft von unseren Servern entfernt.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Abbrechen</AlertDialogCancel>
                  <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                    Ja, alles löschen
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
