import { useExportMyData, useDeleteMyData, useGetCurrentUser, useUpdateMe, getGetCurrentUserQueryKey, getAuthToken } from "@workspace/api-client-react";
import { CrossFarmConsentDialog } from "@/components/CrossFarmConsentDialog";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Download, Trash2, ShieldCheck, Tractor, Loader2, Sparkles, CreditCard, Zap, Crown, AlertTriangle, CheckCircle2, TrendingUp, Users, Copy, X, Mail, Clock, Sun, Moon, Monitor, Thermometer, XCircle } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect, useCallback } from "react";
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
  creditsUsed: number;
  creditsLimit: number | null;
  // Legacy aliases (backwards compat)
  analysesUsed?: number;
  analysesLimit?: number | null;
  periodEnd: string | null;
  gracePeriodEndsAt: string | null;
  stripeCustomerId: string | null;
};

const PLAN_LABELS: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  free:        { label: "Basis",       color: "text-muted-foreground", icon: Zap },
  basis:       { label: "Basis",       color: "text-muted-foreground", icon: Zap },
  starter:     { label: "Professional", color: "text-blue-600",         icon: TrendingUp },
  pro:         { label: "Premium",      color: "text-primary",          icon: Crown },
  premium_max: { label: "Premium Max",  color: "text-amber-600",        icon: Crown },
  beta:        { label: "Beta",         color: "text-purple-600",       icon: Zap },
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

  // Show success/cancel toast from Stripe redirect; auto-open portal on ?action=cancel
  useEffect(() => {
    const params = new URLSearchParams(search);
    if (params.get("billing") === "success") {
      toast({ title: "Zahlung erfolgreich", description: "Dein Abonnement wurde aktiviert." });
      window.history.replaceState(null, "", window.location.pathname);
    } else if (params.get("billing") === "cancel") {
      toast({ variant: "destructive", title: "Zahlung abgebrochen" });
      window.history.replaceState(null, "", window.location.pathname);
    } else if (params.get("action") === "cancel") {
      window.history.replaceState(null, "", window.location.pathname);
      // Auto-trigger Stripe Customer Portal for cancellation
      handlePortal();
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

  const planInfo = PLAN_LABELS[status.plan] ?? PLAN_LABELS.basis;
  const PlanIcon = planInfo.icon;
  const isPro = status.plan === "pro" || status.plan === "premium_max";
  const limit = status.creditsLimit ?? status.analysesLimit ?? null;
  const used = status.creditsUsed ?? status.analysesUsed ?? 0;
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
          Verwalte deinen Tarif und verfolge deinen monatlichen Credit-Verbrauch.
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
                sonst wird dein Konto auf den Basis-Tarif downgegradet.
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
            <div className="flex items-center gap-2 flex-wrap justify-end">
              <Button variant="outline" size="sm" onClick={handlePortal} disabled={portalLoading} className="gap-1.5 text-xs">
                {portalLoading && <Loader2 className="w-3 h-3 animate-spin" />}
                Abo verwalten
              </Button>
              {status.plan !== "basis" && status.plan !== "free" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handlePortal}
                  disabled={portalLoading}
                  className="gap-1.5 text-xs border-destructive/40 text-destructive hover:bg-destructive/5 hover:text-destructive"
                >
                  {portalLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                  Abo kündigen
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Credit progress */}
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Credits diesen Monat</span>
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
              Unbegrenzte Credits inklusive
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Einfache Analyse = 1 Credit · Komplexe Analyse = 3 Credits · Kalkulator = 5 Credits
          </p>
          {isAtLimit && (
            <p className="text-xs text-destructive">
              Credits aufgebraucht. Upgrade für weitere Analysen diesen Monat.
            </p>
          )}
        </div>

        {/* Upgrade options */}
        {!isPro && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            {(status.plan === "free" || status.plan === "basis") && (
              <div className="border rounded-xl p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold text-sm">Professional</span>
                  <span className="ml-auto text-xs text-muted-foreground">19 €/Monat zzgl. USt.</span>
                </div>
                <ul className="text-xs text-muted-foreground space-y-1">
                  <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> 60 Credits/Monat</li>
                  <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Alle Vorlagen</li>
                  <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Unbegrenzte Wissensfragen</li>
                </ul>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full text-xs"
                  onClick={() => handleUpgrade("starter")}
                  disabled={checkoutLoading !== null}
                >
                  {checkoutLoading === "starter" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                  Auf Professional upgraden
                </Button>
              </div>
            )}

            <div className={`border rounded-xl p-4 space-y-2 ${
              status.plan !== "starter" ? "border-primary/30 bg-primary/3" : "col-span-full sm:col-auto"
            }`}>
              <div className="flex items-center gap-2">
                <Crown className="w-4 h-4 text-primary" />
                <span className="font-semibold text-sm">Premium</span>
                <span className="ml-auto text-xs text-muted-foreground">49 €/Monat zzgl. USt.</span>
              </div>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> 200 Credits/Monat</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> Daten-Upload & Tiefenanalysen</li>
                <li className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary shrink-0" /> 3 Team-Einladungen</li>
              </ul>
              <Button
                size="sm"
                className="w-full text-xs"
                onClick={() => handleUpgrade("pro")}
                disabled={checkoutLoading !== null}
              >
                {checkoutLoading === "pro" && <Loader2 className="w-3 h-3 animate-spin mr-1" />}
                Auf Premium upgraden
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Team types ────────────────────────────────────────────────────────────────

type TeamInvite = {
  id: string;
  guestEmail: string;
  guestUserId: string | null;
  guestName: string | null;
  token: string;
  status: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  transitionEndsAt: string | null;
};

function useTeamInvites() {
  const { getToken } = useAuth();
  const [invites, setInvites] = useState<TeamInvite[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/team/invites`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) setInvites(await res.json());
    } catch {
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => { load(); }, [load]);

  return { invites, loading, reload: load };
}

function TeamSection({ billingPlan }: { billingPlan: string | null }) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { invites, loading, reload } = useTeamInvites();
  const [email, setEmail] = useState("");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const MAX_SLOTS = billingPlan === "premium_max" ? Infinity : 3;
  const isPro = billingPlan === "pro" || billingPlan === "premium_max";

  const now = new Date();
  const activeInvites = invites?.filter((i) => {
    if (i.status === "pending") return !i.expiresAt || new Date(i.expiresAt) > now;
    if (i.status === "accepted") return !i.revokedAt;
    if (i.status === "revoked") return !!(i.transitionEndsAt && new Date(i.transitionEndsAt) > now);
    return false;
  }) ?? [];
  const slotsLeft = MAX_SLOTS - activeInvites.length;

  const BASE_PATH = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

  function inviteLink(token: string) {
    return `${window.location.origin}${BASE_PATH}/team/accept/${token}`;
  }

  async function handleCreate() {
    if (!email.trim() || slotsLeft <= 0) return;
    setCreating(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/team/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ guestEmail: email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Fehler", description: data.error ?? "Einladung fehlgeschlagen." });
        return;
      }
      toast({ title: "Einladung erstellt", description: `Einladungslink für ${email.trim()} wurde erstellt.` });
      setEmail("");
      reload();
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Verbindung fehlgeschlagen." });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(id: string) {
    setRevoking(id);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/team/invites/${id}`, {
        method: "DELETE",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({ variant: "destructive", title: "Fehler", description: data.error ?? "Widerrufen fehlgeschlagen." });
        return;
      }
      toast({ title: "Einladung widerrufen", description: "Der Zugriff wird nach einer Übergangsfrist von 30 Tagen entzogen." });
      reload();
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Verbindung fehlgeschlagen." });
    } finally {
      setRevoking(null);
    }
  }

  function copyLink(token: string) {
    navigator.clipboard.writeText(inviteLink(token)).then(() => {
      toast({ title: "Link kopiert" });
    });
  }

  function statusBadge(invite: TeamInvite) {
    if (invite.status === "revoked") {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Widerrufen</span>;
    }
    if (invite.status === "accepted") {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary">Aktiv</span>;
    }
    const expired = new Date(invite.expiresAt) < new Date();
    if (expired) {
      return <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">Abgelaufen</span>;
    }
    return <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">Ausstehend</span>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5 text-primary" />
          Team-Einladungen
        </CardTitle>
        <CardDescription>
          Lade bis zu 3 Personen ein, deine Betriebsdaten als Gast (nur Lesen) einzusehen.
          {!isPro && " Nur im Pro-Tarif verfügbar."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {!isPro ? (
          <div className="flex items-start gap-3 p-4 rounded-lg border border-primary/20 bg-primary/3">
            <Crown className="w-5 h-5 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium">Pro-Tarif erforderlich</p>
              <p className="text-muted-foreground text-xs mt-1">
                Team-Einladungen sind nur im Pro-Tarif verfügbar. Upgrade jetzt für unbegrenzte Analysen und 3 Team-Slots.
              </p>
              <Button asChild size="sm" className="mt-3 text-xs h-7">
                <Link href="/app/upgrade">Jetzt upgraden</Link>
              </Button>
            </div>
          </div>
        ) : (
          <>
            {/* New invite form */}
            <div className="space-y-2">
              <p className="text-sm font-medium">Neue Einladung ({slotsLeft} von {MAX_SLOTS} Slots frei)</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="E-Mail-Adresse des Gastes"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                  disabled={slotsLeft <= 0 || creating}
                  className="flex-1"
                />
                <Button
                  onClick={handleCreate}
                  disabled={!email.trim() || slotsLeft <= 0 || creating}
                  className="gap-2 shrink-0"
                >
                  {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Einladen
                </Button>
              </div>
              {slotsLeft <= 0 && (
                <p className="text-xs text-muted-foreground">Maximale Team-Größe erreicht. Widerrufe eine Einladung, um einen Slot freizugeben.</p>
              )}
            </div>

            {/* Invite list */}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                Einladungen werden geladen…
              </div>
            ) : invites && invites.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Gesendete Einladungen</p>
                <div className="divide-y border rounded-lg overflow-hidden">
                  {invites.map((invite) => (
                    <div key={invite.id} className="flex items-center gap-3 px-3 py-2.5 bg-card">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{invite.guestEmail}</span>
                          {statusBadge(invite)}
                        </div>
                        {invite.guestName && (
                          <p className="text-xs text-muted-foreground">{invite.guestName}</p>
                        )}
                        {invite.status === "revoked" && invite.transitionEndsAt && new Date(invite.transitionEndsAt) > new Date() && (
                          <p className="text-xs text-amber-600 flex items-center gap-1 mt-0.5">
                            <Clock className="w-3 h-3 shrink-0" />
                            Übergangsfrist bis {new Date(invite.transitionEndsAt).toLocaleDateString("de-DE")}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {invite.status === "pending" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs gap-1"
                            onClick={() => copyLink(invite.token)}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            <span className="hidden sm:inline">Link</span>
                          </Button>
                        )}
                        {(invite.status === "pending" || invite.status === "accepted") && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 px-2 text-xs text-destructive hover:text-destructive gap-1"
                            onClick={() => handleRevoke(invite.id)}
                            disabled={revoking === invite.id}
                          >
                            {revoking === invite.id
                              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              : <X className="w-3.5 h-3.5" />
                            }
                            <span className="hidden sm:inline">Widerrufen</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-2">Noch keine Einladungen gesendet.</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TeamSectionWrapper() {
  const { status } = useBillingStatus();
  return <TeamSection billingPlan={status?.plan ?? null} />;
}

function StallstandortSection() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [cooling, setCooling] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const token = await getToken();
        const res = await fetch("/api/thi/settings", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;
        if (data.lat != null) setLat(String(data.lat));
        if (data.lng != null) setLng(String(data.lng));
        if (data.stallCoolingCorrection != null) setCooling(Number(data.stallCoolingCorrection));
      } catch {}
      if (!cancelled) setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [getToken]);

  async function handleSave() {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      toast({ variant: "destructive", title: "Ungültige Koordinaten", description: "Breitengrad muss zwischen -90 und 90 liegen." });
      return;
    }
    if (isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
      toast({ variant: "destructive", title: "Ungültige Koordinaten", description: "Längengrad muss zwischen -180 und 180 liegen." });
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch("/api/thi/settings", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ lat: latNum, lng: lngNum, stallCoolingCorrection: cooling }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Standort gespeichert", description: "THI-Vorhersagen werden ab jetzt für deinen Betrieb berechnet." });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Standort konnte nicht gespeichert werden." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Thermometer className="w-5 h-5 text-primary" />
          Stallstandort & Hitzestress (THI)
        </CardTitle>
        <CardDescription>
          GPS-Koordinaten deines Betriebs für automatische Wetterprognosen und THI-Berechnung. Der THI-Korrekturfaktor berücksichtigt Kühlung im Stall.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin" /> Lade Einstellungen…
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Breitengrad (Lat)</label>
                <Input
                  type="number"
                  step="0.0001"
                  placeholder="z.B. 48.1374"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">z.B. München: 48.1374</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Längengrad (Lng)</label>
                <Input
                  type="number"
                  step="0.0001"
                  placeholder="z.B. 11.5755"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">z.B. München: 11.5755</p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Stallkühlung / Korrekturfaktor</label>
                <span className="text-sm font-semibold tabular-nums" style={{ fontFamily: "var(--app-font-display)" }}>
                  {cooling > 0 ? `+${cooling}` : cooling}
                </span>
              </div>
              <input
                type="range"
                min={-15}
                max={0}
                step={1}
                value={cooling}
                onChange={(e) => setCooling(Number(e.target.value))}
                className="w-full accent-primary"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>−15 (stark gekühlt)</span>
                <span>0 (keine Kühlung)</span>
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Beispiele: Keine Kühlung → 0 · Ventilatoren → −3 bis −5 · Sprüh­kühlung → −8 bis −10 · Klimaanlage → −12 bis −15
              </p>
            </div>

            <Button onClick={handleSave} disabled={saving} className="w-full sm:w-auto">
              {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Speichern…</> : "Standort speichern"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ThemeSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isDark, setTheme } = useTheme();
  const updateMe = useUpdateMe({
    mutation: {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
      },
      onError: () => {
        toast({ variant: "destructive", title: "Fehler", description: "Design konnte nicht gespeichert werden." });
      },
    },
  });

  function handleSelect(value: "light" | "dark") {
    setTheme(value);
    updateMe.mutate({ themePreference: value });
  }

  const current = isDark ? "dark" : "light";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Monitor className="w-5 h-5 text-primary" />
          Erscheinungsbild
        </CardTitle>
        <CardDescription>
          Wähle zwischen hellem und dunklem Design. Die Einstellung wird geräteübergreifend gespeichert.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex gap-3">
          <button
            onClick={() => handleSelect("light")}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-all ${
              current === "light"
                ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                : "border-border hover:border-primary/40 hover:bg-muted/50"
            }`}
          >
            <Sun className="w-4 h-4" />
            Hell
          </button>
          <button
            onClick={() => handleSelect("dark")}
            className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm transition-all ${
              current === "dark"
                ? "border-primary bg-primary/5 ring-1 ring-primary font-medium"
                : "border-border hover:border-primary/40 hover:bg-muted/50"
            }`}
          >
            <Moon className="w-4 h-4" />
            Dunkel
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

import { PageLayout } from "@/components/PageLayout";

function PatternSharingSection() {
  const { data: dbUser } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [consentDialogOpen, setConsentDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const isOptedIn = (dbUser as any)?.patternSharingOptedIn ?? false;

  const setOptIn = async (optIn: boolean) => {
    setIsLoading(true);
    try {
      const token = await getAuthToken();
      const res = await fetch(`${API_BASE}/api/me/pattern-sharing-consent`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ optIn }),
      });
      if (!res.ok) throw new Error("Fehler");
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      toast({
        title: optIn ? "Aktiviert" : "Deaktiviert",
        description: optIn
          ? "Betriebsübergreifende Empfehlungen sind jetzt aktiviert."
          : "Du hast die Einwilligung widerrufen.",
      });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Speichern fehlgeschlagen." });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Betriebsübergreifende Empfehlungen
          </CardTitle>
          <CardDescription>
            Profitiere von anonymisierten Erfolgsmustern anderer opt-in-Betriebe — fachlich geprüft vor der Anzeige.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-lg bg-secondary/20">
            <div>
              <h3 className="font-medium text-foreground flex items-center gap-2">
                {isOptedIn ? (
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                ) : (
                  <XCircle className="w-4 h-4 text-muted-foreground" />
                )}
                {isOptedIn ? "Aktiviert" : "Nicht aktiviert"}
              </h3>
              <p className="text-sm text-muted-foreground mt-0.5">
                {isOptedIn
                  ? "Deine anonymisierten KPI-Zeitreihen fließen in die Muster-Erkennung ein. Du erhältst Empfehlungen aus dem Erfahrungspool."
                  : "Aktiviere die Funktion, um Empfehlungen basierend auf geprüften Mustern anderer Betriebe zu erhalten."}
              </p>
              {isOptedIn && (dbUser as any)?.patternSharingConsentedAt && (
                <p className="text-xs text-muted-foreground mt-1">
                  Eingewilligt am{" "}
                  {new Date((dbUser as any).patternSharingConsentedAt).toLocaleDateString("de-DE", {
                    day: "2-digit",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
            <Button
              variant={isOptedIn ? "outline" : "default"}
              onClick={() => {
                if (isOptedIn) {
                  setOptIn(false);
                } else {
                  setConsentDialogOpen(true);
                }
              }}
              disabled={isLoading}
              className="shrink-0 gap-2"
            >
              {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
              {isOptedIn ? "Widerrufen" : "Aktivieren"}
            </Button>
          </div>
        </CardContent>
      </Card>
      <CrossFarmConsentDialog
        open={consentDialogOpen}
        onOpenChange={setConsentDialogOpen}
        onConsent={() => {
          setConsentDialogOpen(false);
          setOptIn(true);
        }}
      />
    </>
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
    <PageLayout size="narrow">
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

      <StallstandortSection />

      <ThemeSection />

      <BillingSection />

      <TeamSectionWrapper />

      <PatternSharingSection />

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
    </PageLayout>
  );
}
