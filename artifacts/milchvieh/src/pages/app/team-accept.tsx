import { useState, useEffect } from "react";
import { useRoute, useLocation } from "wouter";
import { useAuth, useUser } from "@clerk/react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, CheckCircle2, XCircle, Users, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
const BASE_PATH = (import.meta.env.BASE_URL ?? "").replace(/\/$/, "");

type InviteInfo = {
  id: string;
  guestEmail: string;
  status: string;
  expiresAt: string;
  hostName: string;
  hostEmail: string | null;
  alreadyAccepted?: boolean;
};

export function TeamAcceptPage() {
  const [, params] = useRoute("/team/accept/:token");
  const token = params?.token ?? "";
  const [, navigate] = useLocation();
  const { getToken, isSignedIn, isLoaded } = useAuth();
  const { user } = useUser();
  const { toast } = useToast();

  const [invite, setInvite] = useState<InviteInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/team/accept/${token}`)
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setLoadError(data.error ?? "Einladung konnte nicht geladen werden.");
          return;
        }
        setInvite(data);
        if (data.alreadyAccepted) setAccepted(true);
      })
      .catch(() => setLoadError("Verbindung zum Server fehlgeschlagen."))
      .finally(() => setLoadingInvite(false));
  }, [token]);

  async function handleAccept() {
    if (!isSignedIn) return;
    setAccepting(true);
    try {
      const authToken = await getToken();
      const res = await fetch(`${API_BASE}/api/team/accept/${token}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Fehler", description: data.error ?? "Einladung konnte nicht angenommen werden." });
        return;
      }
      setAccepted(true);
      toast({ title: "Einladung angenommen", description: `Du hast jetzt Lesezugriff auf die Betriebe von ${invite?.hostName ?? "deinem Gastgeber"}.` });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Verbindung zum Server fehlgeschlagen." });
    } finally {
      setAccepting(false);
    }
  }

  if (loadingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mx-auto">
              <XCircle className="w-6 h-6 text-destructive" />
            </div>
            <h2 className="text-lg font-semibold">Einladung ungültig</h2>
            <p className="text-muted-foreground text-sm">{loadError}</p>
            <Button asChild variant="outline" className="w-full">
              <a href={BASE_PATH || "/"}>Zur Startseite</a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (accepted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-background">
        <Card className="w-full max-w-md">
          <CardContent className="pt-8 pb-6 text-center space-y-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-lg font-semibold">Einladung angenommen!</h2>
            <p className="text-muted-foreground text-sm">
              Du hast nun Lesezugriff auf die Betriebe von <strong>{invite?.hostName}</strong>.
            </p>
            <Button onClick={() => navigate("/app/datasets")} className="w-full gap-2">
              Zu meinen Betrieben
              <ArrowRight className="w-4 h-4" />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="w-full max-w-md space-y-4">
        <Card>
          <CardHeader className="text-center pb-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
              <Users className="w-6 h-6 text-primary" />
            </div>
            <CardTitle>Team-Einladung</CardTitle>
            <CardDescription>
              <strong>{invite?.hostName}</strong> lädt dich ein, Lesezugriff auf
              ihre Betriebsdaten zu erhalten.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-3 rounded-lg bg-secondary/50 text-sm space-y-1">
              <p className="text-muted-foreground">Eingeladen für:</p>
              <p className="font-medium">{invite?.guestEmail}</p>
            </div>
            <div className="text-xs text-muted-foreground">
              Gültig bis: {invite?.expiresAt ? new Date(invite.expiresAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—"}
            </div>

            {!isLoaded ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : isSignedIn ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Angemeldet als <strong>{user?.primaryEmailAddress?.emailAddress ?? user?.firstName}</strong>
                </p>
                <Button onClick={handleAccept} disabled={accepting} className="w-full gap-2">
                  {accepting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Einladung annehmen
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Melde dich an, um die Einladung anzunehmen.
                </p>
                <Button asChild className="w-full gap-2">
                  <a href={`${BASE_PATH}/sign-in?redirect_url=${encodeURIComponent(window.location.href)}`}>
                    Anmelden &amp; Einladung annehmen
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
