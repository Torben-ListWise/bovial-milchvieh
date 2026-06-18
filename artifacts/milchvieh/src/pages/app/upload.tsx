import { useState } from "react";
import { useListFiles, getListFilesQueryKey, useRequestUploadUrl, useRegisterFile, useDeleteFile } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadCloud, File, AlertCircle, CheckCircle, Clock, Trash2 } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { useRequireDataset } from "@/hooks/use-require-dataset";

export function UploadPage() {
  const { datasetId, isLoading: datasetLoading } = useRequireDataset();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const requestUrl = useRequestUploadUrl();
  const registerFile = useRegisterFile();
  const deleteFile = useDeleteFile();
  const [isUploading, setIsUploading] = useState(false);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);

  const { data: files, isLoading } = useListFiles(
    datasetId ?? "",
    { query: { enabled: !!datasetId, queryKey: getListFilesQueryKey(datasetId ?? "") } }
  );

  if (datasetLoading || !datasetId) {
    return <div className="h-32 flex items-center justify-center text-muted-foreground">Laden…</div>;
  }

  const handleDelete = (fileId: string) => {
    deleteFile.mutate(
      { fileId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId) });
          toast({ title: "Datei gelöscht" });
          setDeleteFileId(null);
        },
        onError: () => {
          toast({ variant: "destructive", title: "Fehler", description: "Datei konnte nicht gelöscht werden." });
          setDeleteFileId(null);
        },
      }
    );
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const { uploadURL, objectPath } = await requestUrl.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream"
        }
      });

      const uploadRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file
      });

      if (!uploadRes.ok) throw new Error("Upload fehlgeschlagen");

      await registerFile.mutateAsync({
        datasetId,
        data: {
          objectPath,
          name: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        }
      });

      toast({ title: "Erfolg", description: "Datei wurde erfolgreich hochgeladen und wird nun verarbeitet." });
      queryClient.invalidateQueries({ queryKey: getListFilesQueryKey(datasetId) });
    } catch (error) {
      console.error(error);
      toast({ variant: "destructive", title: "Fehler", description: "Beim Upload ist ein Fehler aufgetreten." });
    } finally {
      setIsUploading(false);
      if (e.target) e.target.value = '';
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Dateien & Upload</h1>
        <p className="text-muted-foreground mt-1">Laden Sie Ihre Herdenmanagement-Exporte (Excel, CSV, PDF) hier hoch.</p>
      </div>

      <Card className="border-dashed bg-secondary/10">
        <CardContent className="flex flex-col items-center justify-center py-12">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <UploadCloud className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Datei auswählen oder hierher ziehen</h3>
          <p className="text-muted-foreground mb-6">Unterstützte Formate: Excel, CSV, PDF, PPT</p>
          <div className="relative">
            <Button disabled={isUploading} className="relative z-10 pointer-events-none">
              {isUploading ? 'Wird hochgeladen...' : 'Durchsuchen'}
            </Button>
            <input
              type="file"
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-20"
              onChange={handleFileSelect}
              disabled={isUploading}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-8">
        <h3 className="text-xl font-bold mb-4">Ihre Dateien</h3>
        {isLoading ? (
          <div className="space-y-2"><div className="h-16 bg-muted animate-pulse rounded-md" /></div>
        ) : !files || files.length === 0 ? (
          <Card>
            <CardContent className="p-0">
              <div className="text-center py-8 text-muted-foreground">
                Noch keine Dateien hochgeladen.
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {files.map(f => (
              <Card key={f.id} className="hover:border-primary/50 transition-colors group">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <File className="w-8 h-8 text-primary/60" />
                    <div>
                      <p className="font-medium text-foreground">{f.name}</p>
                      <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                        <span>{format(new Date(f.createdAt), "dd.MM.yyyy HH:mm", { locale: de })}</span>
                        <span>{f.size ? `${(f.size / 1024 / 1024).toFixed(2)} MB` : ''}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {f.status === 'ready' && <span className="bg-green-100 text-green-800 text-xs px-2 py-1 rounded flex items-center gap-1"><CheckCircle className="w-3 h-3"/> Bereit</span>}
                    {f.status === 'error' && <span className="bg-red-100 text-red-800 text-xs px-2 py-1 rounded flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Fehler</span>}
                    {(f.status === 'uploaded' || f.status === 'parsing' || f.status === 'mapping') &&
                      <span className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded flex items-center gap-1"><Clock className="w-3 h-3"/> Verarbeitung…</span>
                    }
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => setDeleteFileId(f.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!deleteFileId} onOpenChange={(open) => { if (!open) setDeleteFileId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Datei löschen?</AlertDialogTitle>
            <AlertDialogDescription>
              Die Datei und alle daraus verarbeiteten Datensätze werden unwiderruflich entfernt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteFile.isPending}>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteFile.isPending}
              onClick={() => deleteFileId && handleDelete(deleteFileId)}
            >
              Löschen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
