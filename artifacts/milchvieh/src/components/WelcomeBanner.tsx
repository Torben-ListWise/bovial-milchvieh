import { useState } from "react";
import { Link } from "wouter";
import { X, UploadCloud, BarChart2, Share2, ArrowRight, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  datasetId: string | null;
}

const STEPS = [
  {
    icon: UploadCloud,
    step: "1",
    title: "Datei hochladen",
    description: "Lade deinen MLP-Excel-Export, eine CSV-Datei oder ein PDF hoch.",
    color: "bg-blue-500/10 text-blue-600",
  },
  {
    icon: BarChart2,
    step: "2",
    title: "Erste Analyse starten",
    description: "Der Assistent erstellt sofort einen vollständigen Betriebsspiegel.",
    color: "bg-primary/10 text-primary",
  },
  {
    icon: Share2,
    step: "3",
    title: "Ergebnisse teilen",
    description: "Exportiere Berichte als PDF und teile sie mit deinem Berater.",
    color: "bg-green-500/10 text-green-600",
  },
];

export function WelcomeBanner({ datasetId }: Props) {
  // Session-scoped dismissal: hiding the banner lasts only for this browser session.
  // Permanent suppression is handled server-side (onboardingCompletedAt set on first upload).
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try { return sessionStorage.getItem("welcome-banner-dismissed") === "1"; } catch { return false; }
  });

  if (dismissed) return null;

  function handleDismiss() {
    try { sessionStorage.setItem("welcome-banner-dismissed", "1"); } catch {}
    setDismissed(true);
  }

  const uploadHref = datasetId
    ? `/app/upload?datasetId=${datasetId}`
    : "/app/upload";

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-4">
      <div className="relative rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/5 via-background to-blue-500/5 p-5 sm:p-6 shadow-sm">
        <button
          onClick={handleDismiss}
          className="absolute top-3 right-3 p-1 rounded-full hover:bg-muted text-muted-foreground transition-colors"
          aria-label="Banner schließen"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="mb-4">
          <h2 className="text-lg font-bold text-foreground">
            👋 Willkommen! So geht's los
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            In drei Schritten zur ersten Betriebsauswertung
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
          {STEPS.map((s) => {
            const Icon = s.icon;
            return (
              <div
                key={s.step}
                className="flex items-start gap-3 rounded-xl bg-card border border-border p-3"
              >
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${s.color}`}>
                  <Icon className="w-4.5 h-4.5 w-[18px] h-[18px]" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-muted-foreground/70 uppercase tracking-wide mb-0.5">
                    Schritt {s.step}
                  </p>
                  <p className="text-sm font-semibold text-foreground">{s.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                    {s.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button asChild size="sm" className="gap-2">
            <Link href={uploadHref}>
              <UploadCloud className="w-4 h-4" />
              Erste Datei hochladen
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </Button>
          <button
            onClick={handleDismiss}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Später erledigen
          </button>
        </div>
      </div>
    </div>
  );
}

export function OnboardingCompleteBanner({ datasetId }: Props) {
  const [dismissed, setDismissed] = useState<boolean>(() => {
    return localStorage.getItem("onboarding-complete-banner-dismissed") === "1";
  });

  if (dismissed) return null;

  function handleDismiss() {
    localStorage.setItem("onboarding-complete-banner-dismissed", "1");
    setDismissed(true);
  }

  const analysesHref = datasetId
    ? `/app/analyses?datasetId=${datasetId}`
    : "/app/analyses";

  return (
    <div className="mx-auto max-w-5xl px-4 sm:px-6 pt-4">
      <div className="relative rounded-2xl border border-green-500/30 bg-green-500/5 p-4 flex items-center gap-4">
        <div className="w-9 h-9 rounded-full bg-green-500/10 flex items-center justify-center shrink-0">
          <CheckCircle className="w-5 h-5 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground">
            Schritt 1 erledigt — deine erste Datei ist da!
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Die Analyse läuft bereits im Hintergrund. Sieh dir die ersten Ergebnisse an.
          </p>
        </div>
        <Button asChild size="sm" variant="outline" className="shrink-0 gap-1.5">
          <Link href={analysesHref}>
            Zur Analyse
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </Button>
        <button
          onClick={handleDismiss}
          className="p-1 rounded-full hover:bg-muted text-muted-foreground transition-colors shrink-0"
          aria-label="Schließen"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
