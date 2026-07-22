import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Check, X } from "lucide-react";

interface CrossFarmConsentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConsent: () => void;
}

export function CrossFarmConsentDialog({
  open,
  onOpenChange,
  onConsent,
}: CrossFarmConsentDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Anonymisierte Muster teilen
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-4 text-sm text-foreground">
              <p className="text-muted-foreground">
                Durch deine Teilnahme hilfst du, statistische Erfolgsmuster über
                mehrere Betriebe hinweg zu erkennen. Alle Muster werden vor der
                Anzeige fachlich durch unser Team geprüft und freigegeben.
              </p>

              <div className="space-y-2">
                <p className="font-medium text-foreground">Was wird geteilt:</p>
                <ul className="space-y-1">
                  {[
                    "Anonymisierte KPI-Zeitreihen (z. B. monatliche Konzeptionsrate)",
                    "Zeitlich zugeordnete Betriebsänderungen (aus gespeicherten Betriebsfakten)",
                    "Aggregierte Kennzahlen (Vor-/Nach-Vergleich)",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-muted-foreground">
                      <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-foreground">Was NICHT geteilt wird:</p>
                <ul className="space-y-1">
                  {[
                    "Betriebsname, Adresse oder Kontaktdaten",
                    "Einzelne Tier-IDs oder Rohbewegungsdaten",
                    "Jeglicher Bezug zu deiner Person oder deinem Betrieb",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-muted-foreground">
                      <X className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-2">
                <p className="font-medium text-foreground">Was du erhältst:</p>
                <ul className="space-y-1">
                  {[
                    "Empfehlungen, die auf geprüften Mustern anderer opt-in-Betriebe basieren",
                    "Transparente Kennzeichnung als *[Betriebsübergreifendes Muster]* im Chat",
                    "Jederzeit widerrufbar in den Einstellungen",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2 text-muted-foreground">
                      <Check className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-md border border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/30 p-3 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  <strong>Rechtshinweis:</strong> Der finale Einwilligungstext wurde noch nicht
                  durch einen DSGVO-Anwalt geprüft. Diese Funktion wird erst nach abgeschlossener
                  rechtlicher Prüfung für alle Nutzer aktiviert.
                </p>
              </div>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Ablehnen</AlertDialogCancel>
          <AlertDialogAction onClick={onConsent}>
            Zustimmen &amp; aktivieren
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
