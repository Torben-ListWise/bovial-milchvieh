import { useExportMyData, useDeleteMyData } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, Trash2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
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

      toast({ title: "Erfolg", description: "Ihre Daten wurden erfolgreich exportiert." });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Der Export ist fehlgeschlagen." });
    } finally {
      setIsExporting(false);
    }
  };

  const handleDelete = async () => {
    try {
      await deleteData.mutateAsync();
      toast({ title: "Daten gelöscht", description: "Alle Ihre Daten wurden unwiderruflich gelöscht." });
      signOut({ redirectUrl: "/" });
    } catch {
      toast({ variant: "destructive", title: "Fehler", description: "Beim Löschen ist ein Fehler aufgetreten." });
    }
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Einstellungen & DSGVO</h1>
        <p className="text-muted-foreground mt-1">Verwalten Sie Ihre Daten und Privatsphäre.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-primary" />
            Ihre Daten gehören Ihnen
          </CardTitle>
          <CardDescription>
            Gemäß der europäischen Datenschutz-Grundverordnung (DSGVO) haben Sie das Recht, alle über Sie gespeicherten Daten jederzeit herunterzuladen oder dauerhaft zu löschen.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border rounded-lg bg-secondary/20">
            <div>
              <h3 className="font-medium text-foreground">Datenexport</h3>
              <p className="text-sm text-muted-foreground">Laden Sie alle Ihre Betriebe, Analysen und Regeln als JSON-Datei herunter.</p>
            </div>
            <Button onClick={handleExport} disabled={isExporting} variant="outline" className="gap-2">
              <Download className="w-4 h-4" />
              {isExporting ? "Wird exportiert..." : "Daten exportieren"}
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 border border-destructive/20 rounded-lg bg-destructive/5">
            <div>
              <h3 className="font-medium text-destructive">Konto löschen</h3>
              <p className="text-sm text-muted-foreground">Löscht alle Ihre Daten unwiderruflich. Dies kann nicht rückgängig gemacht werden.</p>
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
                  <AlertDialogTitle>Sind Sie sicher?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Diese Aktion kann nicht rückgängig gemacht werden. Dadurch werden Ihr Konto und Ihre Daten (Betriebe, Analysen, Dateien) dauerhaft von unseren Servern entfernt.
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
