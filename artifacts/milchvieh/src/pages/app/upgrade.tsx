import { useState, useEffect } from "react";
import { CheckoutConfirmationBox, type PlanDetails } from "@/components/CheckoutConfirmationBox";
import { ArrowLeft, Sparkles, CalendarClock, ShieldCheck } from "lucide-react";
import { Link, useSearch } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@clerk/react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const PLANS: (PlanDetails & { key: string })[] = [
  {
    key: "basis",
    name: "Basis",
    pricePerMonth: 1.99,
    analysesPerMonth: 15,
    description: "Einstieg — einfache Auswertungen und Wissensfragen.",
  },
  {
    key: "starter",
    name: "Professional",
    pricePerMonth: 19.0,
    analysesPerMonth: 60,
    description: "Für aktive Betriebe — alle Vorlagen, umfangreiche Auswertungen, Folgefragen inklusive.",
  },
  {
    key: "pro",
    name: "Premium",
    pricePerMonth: 49.0,
    analysesPerMonth: 200,
    description: "Für Betriebsleiter — Tiefenanalysen, Daten-Upload, KI-Investitionsprüfung, 3 Team-Einladungen.",
  },
  {
    key: "premium_max",
    name: "Premium Max",
    pricePerMonth: 99.0,
    analysesPerMonth: "unbegrenzt",
    description: "Maximale Leistung — unbegrenzte Analysen, Prioritäts-Support, ideal für Berater.",
  },
];

import { PageLayout } from "@/components/PageLayout";

function trialEndDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
}

export function UpgradePage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const search = useSearch();
  const isTrial = new URLSearchParams(search).get("trial") === "1";

  const [selectedPlan, setSelectedPlan] = useState<(PlanDetails & { key: string }) | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (isTrial) {
      const professional = PLANS.find((p) => p.key === "starter") ?? null;
      setSelectedPlan(professional);
    }
  }, [isTrial]);

  async function handleConfirm() {
    if (!selectedPlan) return;
    setIsLoading(true);
    try {
      const token = await getToken();
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const withTrial = isTrial && selectedPlan.key === "starter";

      const response = await fetch(`${API_BASE}/api/checkout/create-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          planKey: selectedPlan.key,
          successUrl: `${origin}${base}/app/settings?upgraded=1`,
          cancelUrl: `${origin}${base}/app/upgrade`,
          withTrial,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Fehler",
          description: data.error ?? "Checkout konnte nicht gestartet werden.",
        });
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      toast({
        variant: "destructive",
        title: "Netzwerkfehler",
        description: "Verbindung zum Server fehlgeschlagen. Bitte versuche es erneut.",
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <PageLayout size="narrow">
      <div className="flex items-center gap-3">
        <Link href="/app/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            {isTrial ? "14 Tage kostenlos testen" : "Tarif upgraden"}
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            {isTrial
              ? "Professional-Funktionsumfang — heute 0 €, danach monatlich kündbar."
              : "Wähle einen Tarif und bestätige die Bestellbedingungen."}
          </p>
        </div>
      </div>

      {isTrial && selectedPlan?.key === "starter" && (
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-primary font-semibold text-sm">
            <CalendarClock className="w-4 h-4 shrink-0" />
            Transparenzhinweis (§ 312 BGB)
          </div>
          <div className="text-sm text-foreground space-y-1.5">
            <p>
              <span className="font-semibold">Heute zu zahlen: 0 €</span>
            </p>
            <p>
              Danach automatisch <span className="font-semibold">19 €/Monat (inkl. 19 % MwSt.)</span> ab dem{" "}
              <span className="font-semibold">{trialEndDate()}</span>, sofern nicht vorher gekündigt.
            </p>
            <p className="text-muted-foreground text-xs">
              Deine Zahlungsdaten werden bei Stripe gespeichert, damit der automatische Übergang funktioniert.
              Du kannst jederzeit ohne Angabe von Gründen kündigen — über den Kündigungsbutton in den Einstellungen.
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5 text-primary shrink-0" />
            Keine Abbuchung während des Testzeitraums — Erinnerung 3 Tage vor Ende
          </div>
        </div>
      )}

      {!selectedPlan ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {PLANS.map((plan) => (
            <button
              key={plan.key}
              onClick={() => setSelectedPlan(plan)}
              className="text-left rounded-xl border-2 border-border hover:border-primary/50 bg-card p-5 transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="font-bold text-foreground text-lg">{plan.name}</span>
                <span className="text-primary font-bold text-lg">
                  {plan.pricePerMonth.toFixed(2).replace(".", ",")} €
                  <span className="text-xs font-normal text-muted-foreground"> / Monat</span>
                </span>
              </div>
              <p className="text-sm text-muted-foreground mb-3">{plan.description}</p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">inkl. 19 % MwSt.</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {!isTrial && (
            <button
              onClick={() => setSelectedPlan(null)}
              className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Anderen Tarif wählen
            </button>
          )}
          <CheckoutConfirmationBox
            plan={selectedPlan}
            onConfirm={handleConfirm}
            isLoading={isLoading}
          />
        </div>
      )}
    </PageLayout>
  );
}
