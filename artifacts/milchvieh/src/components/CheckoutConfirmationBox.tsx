import { useState } from "react";
import { Link } from "wouter";
import { ShieldCheck, Clock, RefreshCw, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface PlanDetails {
  name: string;
  pricePerMonth: number;
  analysesPerMonth: number | "unbegrenzt";
  description?: string;
}

interface CheckoutConfirmationBoxProps {
  plan: PlanDetails;
  onConfirm: () => void;
  isLoading?: boolean;
  className?: string;
}

export function CheckoutConfirmationBox({
  plan,
  onConfirm,
  isLoading = false,
  className,
}: CheckoutConfirmationBoxProps) {
  const [agbAccepted, setAgbAccepted] = useState(false);
  const [withdrawalAccepted, setWithdrawalAccepted] = useState(false);

  // pricePerMonth is the net price (zzgl. 19 % MwSt.)
  const priceNet = plan.pricePerMonth;
  const vat = Math.round(priceNet * 0.19 * 100) / 100;
  const priceGross = Math.round((priceNet + vat) * 100) / 100;

  const canProceed = agbAccepted && withdrawalAccepted;

  return (
    <div className={cn("border border-border rounded-xl bg-card divide-y divide-border", className)}>
      {/* Header */}
      <div className="px-5 py-4">
        <h3 className="font-semibold text-foreground text-base flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
          Bestellübersicht — Pflichtangaben nach Fernabsatzrecht
        </h3>
        <p className="text-xs text-muted-foreground mt-1">
          Bitte lies die folgenden Informationen vor dem Kauf sorgfältig durch.
        </p>
      </div>

      {/* Product details table */}
      <div className="px-5 py-4 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Wesentliche Merkmale des digitalen Produkts
        </h4>
        <div className="rounded-lg border border-border overflow-hidden text-sm">
          <table className="w-full">
            <tbody className="divide-y divide-border">
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground font-medium w-2/5">Produkt</td>
                <td className="px-4 py-2.5 text-foreground font-semibold">
                  Bovial — {plan.name}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground font-medium">Leistung</td>
                <td className="px-4 py-2.5 text-foreground">
                  {typeof plan.analysesPerMonth === "number"
                    ? `${plan.analysesPerMonth} KI-Analysen pro Monat`
                    : "Unbegrenzte KI-Analysen pro Monat"}
                  {plan.description && (
                    <span className="block text-xs text-muted-foreground mt-0.5">{plan.description}</span>
                  )}
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground font-medium">Nettobetrag</td>
                <td className="px-4 py-2.5 text-foreground">
                  {priceNet.toFixed(2).replace(".", ",")} €
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground font-medium">MwSt. (19 %)</td>
                <td className="px-4 py-2.5 text-foreground">
                  {vat.toFixed(2).replace(".", ",")} €
                </td>
              </tr>
              <tr className="bg-muted/30">
                <td className="px-4 py-2.5 text-foreground font-bold">Gesamtpreis (brutto)</td>
                <td className="px-4 py-2.5 text-foreground font-bold text-primary">
                  {priceGross.toFixed(2).replace(".", ",")} € / Monat
                </td>
              </tr>
              <tr>
                <td className="px-4 py-2.5 text-muted-foreground font-medium">Abrechnung</td>
                <td className="px-4 py-2.5 text-foreground">Monatlich, automatische Verlängerung</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Terms */}
      <div className="px-5 py-4 space-y-3">
        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Laufzeit &amp; Kündigung
        </h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex items-start gap-3 rounded-lg bg-muted/30 px-3 py-3">
            <Clock className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Monatliche Laufzeit</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Das Abonnement läuft monatlich und verlängert sich automatisch.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-lg bg-muted/30 px-3 py-3">
            <RefreshCw className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Kündigung jederzeit</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Kündigung bis zum letzten Tag des laufenden Abrechnungszeitraums —
                ohne Angabe von Gründen, direkt in den Kontoeinstellungen.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="agb-check"
            checked={agbAccepted}
            onCheckedChange={(v) => setAgbAccepted(Boolean(v))}
            className="mt-0.5 shrink-0"
          />
          <label htmlFor="agb-check" className="text-sm text-foreground leading-relaxed cursor-pointer select-none">
            Ich habe die{" "}
            <Link href="/agb" className="text-primary hover:underline font-medium">
              Allgemeinen Geschäftsbedingungen
            </Link>{" "}
            und die{" "}
            <Link href="/datenschutz" className="text-primary hover:underline font-medium">
              Datenschutzerklärung
            </Link>{" "}
            gelesen und stimme ihnen zu. <span className="text-destructive font-medium">*</span>
          </label>
        </div>

        <div className="flex items-start gap-3">
          <Checkbox
            id="withdrawal-check"
            checked={withdrawalAccepted}
            onCheckedChange={(v) => setWithdrawalAccepted(Boolean(v))}
            className="mt-0.5 shrink-0"
          />
          <label htmlFor="withdrawal-check" className="text-sm text-foreground leading-relaxed cursor-pointer select-none">
            Ich stimme ausdrücklich zu, dass der Dienst sofort nach Zahlung freigeschaltet wird.
            Mir ist bekannt, dass ich mit dieser Zustimmung mein{" "}
            <strong>14-tägiges Widerrufsrecht verliere</strong>, sobald die Nutzung digitaler Inhalte
            begonnen hat (§ 356 Abs. 5 BGB).{" "}
            <span className="text-destructive font-medium">*</span>
          </label>
        </div>

        {!canProceed && (agbAccepted || withdrawalAccepted) && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            Bitte bestätige beide Checkboxen, um fortzufahren.
          </div>
        )}
      </div>

      {/* CTA */}
      <div className="px-5 py-4">
        <Button
          onClick={onConfirm}
          disabled={!canProceed || isLoading}
          className="w-full h-11 font-semibold"
        >
          {isLoading ? "Weiterleitung …" : `Kostenpflichtig abonnieren — ${priceGross.toFixed(2).replace(".", ",")} € brutto / Monat`}
        </Button>
        <p className="text-xs text-muted-foreground text-center mt-2">
          * Pflichtfelder. Du wirst zur sicheren Bezahlseite (Stripe) weitergeleitet.
        </p>
      </div>
    </div>
  );
}
