import { useExportMyData, useDeleteMyData, useGetCurrentUser, useUpdateMe, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Trash2, ShieldCheck, Tractor, Loader2, Sparkles } from "lucide-react";
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
                Starter (19,00 € / Monat) oder Pro (49,00 € / Monat) — alle Preise inkl. 19 % MwSt.
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
