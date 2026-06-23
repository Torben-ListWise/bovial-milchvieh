import { useState } from "react";
import { CheckoutConfirmationBox, type PlanDetails } from "@/components/CheckoutConfirmationBox";
import { ArrowLeft, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@clerk/react";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

const PLANS: (PlanDetails & { key: string })[] = [
  {
    key: "starter",
    name: "Starter",
    pricePerMonth: 19.0,
    analysesPerMonth: 50,
    description: "Ideal für kleine Betriebe mit gelegentlichem Analysebedarf.",
  },
  {
    key: "pro",
    name: "Pro",
    pricePerMonth: 49.0,
    analysesPerMonth: "unbegrenzt",
    description: "Unbegrenzte Analysen für professionelle Landwirte und Berater.",
  },
];

export function UpgradePage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const [selectedPlan, setSelectedPlan] = useState<(PlanDetails & { key: string }) | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleConfirm() {
    if (!selectedPlan) return;
    setIsLoading(true);
    try {
      const token = await getToken();
      const origin = window.location.origin;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

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
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/app/settings" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Tarif upgraden
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Wähle einen Tarif und bestätige die Bestellbedingungen.
          </p>
        </div>
      </div>

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
              <p className="text-xs text-muted-foreground">
                {typeof plan.analysesPerMonth === "number"
                  ? `${plan.analysesPerMonth} Analysen / Monat`
                  : "Unbegrenzte Analysen / Monat"}
              </p>
              <p className="text-[10px] text-muted-foreground/70 mt-1">inkl. 19 % MwSt.</p>
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          <button
            onClick={() => setSelectedPlan(null)}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Anderen Tarif wählen
          </button>
          <CheckoutConfirmationBox
            plan={selectedPlan}
            onConfirm={handleConfirm}
            isLoading={isLoading}
          />
        </div>
      )}
    </div>
  );
}
