import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import type { KnowledgeDocument } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  Trash2,
  FileText,
  CheckCircle,
  Clock,
  AlertCircle,
  Loader2,
  BookOpen,
  Globe,
  Link,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function StatusBadge({ status, chunkCount }: { status: string; chunkCount?: number | null }) {
  if (status === "ready") {
    return (
      <Badge className="bg-green-100 text-green-800 border-green-200 gap-1">
        <CheckCircle className="w-3 h-3" />
        Bereit ({chunkCount ?? 0} Chunks)
      </Badge>
    );
  }
  if (status === "processing") {
    return (
      <Badge className="bg-blue-100 text-blue-800 border-blue-200 gap-1">
        <Loader2 className="w-3 h-3 animate-spin" />
        Wird geladen...
      </Badge>
    );
  }
  if (status === "pending") {
    return (
      <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 gap-1">
        <Clock className="w-3 h-3" />
        Ausstehend
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-800 border-red-200 gap-1">
      <AlertCircle className="w-3 h-3" />
      Fehler
    </Badge>
  );
}

interface UploadItem {
  file: File;
  title: string;
  status: "pending" | "uploading" | "ingesting" | "done" | "error";
  error?: string;
}

export function KnowledgePage() {
  const { toast } = useToast();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [activeTab, setActiveTab] = useState<"file" | "url">("file");
  const [urlInput, setUrlInput] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const [urlLoading, setUrlLoading] = useState(false);

  const { data: docs = [], isLoading } = useQuery<KnowledgeDocument[]>({
    queryKey: ["knowledge-docs"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/knowledge`, {
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Fehler beim Laden");
      return res.json();
    },
    refetchInterval: (query) => {
      const data = query.state.data as KnowledgeDocument[] | undefined;
      const hasPending = data?.some(
        (d) => d.status === "processing" || d.status === "pending",
      );
      return hasPending ? 2000 : false;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/knowledge/${id}`, {
        method: "DELETE",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error("Löschen fehlgeschlagen");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({ title: "Dokument gelöscht" });
    },
    onError: () => {
      toast({ title: "Fehler beim Löschen", variant: "destructive" });
    },
  });

  async function uploadFile(item: UploadItem) {
    const updateItem = (patch: Partial<UploadItem>) =>
      setUploadItems((prev) =>
        prev.map((i) => (i.file === item.file ? { ...i, ...patch } : i)),
      );

    try {
      updateItem({ status: "uploading" });
      const token = await getToken();
      const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

      const urlRes = await fetch(`${API_BASE}/api/knowledge/upload-url`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...authHeader,
        },
        body: JSON.stringify({
          filename: item.file.name,
          contentType: item.file.type || "application/octet-stream",
          size: item.file.size,
          title: item.title || undefined,
        }),
      });

      if (!urlRes.ok) {
        const errBody = await urlRes.json().catch(() => ({}));
        throw new Error((errBody as { error?: string }).error ?? "Upload-URL konnte nicht erstellt werden");
      }
      const { uploadURL, docId } = await urlRes.json();

      const putRes = await fetch(uploadURL, {
        method: "PUT",
        body: item.file,
        headers: { "Content-Type": item.file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Datei-Upload fehlgeschlagen");

      updateItem({ status: "ingesting" });
      await fetch(`${API_BASE}/api/knowledge/${docId}/ingest`, {
        method: "POST",
        credentials: "include",
        headers: { ...authHeader },
      });

      updateItem({ status: "done" });
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
    } catch (err) {
      updateItem({
        status: "error",
        error: err instanceof Error ? err.message : "Unbekannter Fehler",
      });
    }
  }

  async function handleIngestUrl() {
    setUrlError(null);
    const trimmed = urlInput.trim();
    if (!trimmed) {
      setUrlError("Bitte eine URL eingeben");
      return;
    }
    try {
      new URL(trimmed);
    } catch {
      setUrlError("Ungültige URL — Beispiel: https://www.lfl.bayern.de");
      return;
    }
    if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
      setUrlError("Nur http:// und https:// URLs sind erlaubt");
      return;
    }

    setUrlLoading(true);
    try {
      const token = await getToken();
      const res = await fetch(`${API_BASE}/api/knowledge/ingest-url`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ url: trimmed }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setUrlError((body as any).error ?? "Diese URL wurde bereits hinzugefügt");
        return;
      }
      if (!res.ok) {
        setUrlError((body as any).error ?? "Fehler beim Laden der URL");
        return;
      }
      setUrlInput("");
      queryClient.invalidateQueries({ queryKey: ["knowledge-docs"] });
      toast({ title: "URL wird verarbeitet", description: "Der Inhalt wird geladen und indexiert." });
    } catch {
      setUrlError("Netzwerkfehler — bitte erneut versuchen");
    } finally {
      setUrlLoading(false);
    }
  }

  const ALLOWED_EXTS = [".pdf", ".pptx", ".ppt", ".xlsx", ".xls", ".ods", ".csv", ".tsv", ".txt", ".docx", ".doc"];

  function addFiles(files: File[]) {
    const valid = files.filter((f) =>
      ALLOWED_EXTS.some((ext) => f.name.toLowerCase().endsWith(ext)),
    );
    if (valid.length === 0) {
      toast({
        title: "Ungültiges Format",
        description: "Unterstützte Formate: PDF, Word, Excel, PowerPoint, CSV, TXT.",
        variant: "destructive",
      });
      return;
    }
    const items: UploadItem[] = valid.map((f) => ({
      file: f,
      title: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim(),
      status: "pending",
    }));
    setUploadItems((prev) => [...prev, ...items]);
  }

  function startUpload() {
    const pending = uploadItems.filter((i) => i.status === "pending");
    for (const item of pending) {
      void uploadFile(item);
    }
  }

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(Array.from(e.dataTransfer.files));
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const pendingCount = uploadItems.filter((i) => i.status === "pending").length;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <BookOpen className="w-8 h-8 text-primary" />
          Wissensbibliothek
        </h1>
        <p className="text-muted-foreground mt-1">
          Dokumente hochladen oder Websites hinzufügen. Der Assistent durchsucht diese Inhalte
          semantisch bei Fachfragen.
        </p>
      </div>

      {/* Upload Card with tabs */}
      <Card>
        <CardHeader className="pb-0">
          <div className="flex gap-1 border-b">
            <button
              onClick={() => setActiveTab("file")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === "file"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Upload className="w-4 h-4" />
              Datei hochladen
            </button>
            <button
              onClick={() => setActiveTab("url")}
              className={cn(
                "flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 transition-colors",
                activeTab === "url"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Globe className="w-4 h-4" />
              URL hinzufügen
            </button>
          </div>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {activeTab === "file" && (
            <>
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/30",
                )}
              >
                <Upload className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium text-sm">Datei hierher ziehen</p>
                <p className="text-xs text-muted-foreground mt-1">
                  PDF, Word, Excel, PowerPoint, CSV, TXT — oder klicken zum Auswählen
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.pptx,.ppt,.xlsx,.xls,.ods,.csv,.tsv,.txt,.docx,.doc"
                  multiple
                  className="hidden"
                  onChange={(e) => addFiles(Array.from(e.target.files ?? []))}
                />
              </div>

              {uploadItems.length > 0 && (
                <div className="space-y-2">
                  {uploadItems.map((item, idx) => (
                    <div
                      key={idx}
                      className="flex items-center gap-3 p-3 rounded-md border bg-muted/30"
                    >
                      <FileText className="w-4 h-4 text-muted-foreground shrink-0" />
                      <div className="flex-1 min-w-0">
                        {item.status === "pending" ? (
                          <Input
                            value={item.title}
                            onChange={(e) =>
                              setUploadItems((prev) =>
                                prev.map((i, i2) =>
                                  i2 === idx ? { ...i, title: e.target.value } : i,
                                )
                              )
                            }
                            className="h-7 text-sm"
                            placeholder="Titel (optional)"
                          />
                        ) : (
                          <p className="text-sm font-medium truncate">
                            {item.title || item.file.name}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground truncate">
                          {item.file.name} · {formatBytes(item.file.size)}
                        </p>
                        {item.status === "error" && item.error && (
                          <p className="text-xs text-red-600 mt-0.5">{item.error}</p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {item.status === "pending" && (
                          <Badge variant="secondary">Bereit</Badge>
                        )}
                        {item.status === "uploading" && (
                          <Badge className="bg-blue-100 text-blue-800 gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Lade hoch
                          </Badge>
                        )}
                        {item.status === "ingesting" && (
                          <Badge className="bg-blue-100 text-blue-800 gap-1">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Verarbeite
                          </Badge>
                        )}
                        {item.status === "done" && (
                          <Badge className="bg-green-100 text-green-800 gap-1">
                            <CheckCircle className="w-3 h-3" />
                            Fertig
                          </Badge>
                        )}
                        {item.status === "error" && (
                          <Badge className="bg-red-100 text-red-800 gap-1">
                            <AlertCircle className="w-3 h-3" />
                            Fehler
                          </Badge>
                        )}
                      </div>
                    </div>
                  ))}

                  {pendingCount > 0 && (
                    <Button onClick={startUpload} className="w-full">
                      <Upload className="w-4 h-4 mr-2" />
                      {pendingCount === 1
                        ? "1 Dokument hochladen"
                        : `${pendingCount} Dokumente hochladen`}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab === "url" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Website-URL eingeben — der Inhalt wird automatisch geladen, aufbereitet und zur
                Wissensbibliothek hinzugefügt (bis zu 20 Seiten, eine Ebene tief).
              </p>
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Link className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlError) setUrlError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleIngestUrl();
                    }}
                    placeholder="https://www.lfl.bayern.de/itz/rind/..."
                    className="pl-9"
                    disabled={urlLoading}
                  />
                </div>
                <Button onClick={handleIngestUrl} disabled={urlLoading || !urlInput.trim()}>
                  {urlLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Lädt...
                    </>
                  ) : (
                    "Laden"
                  )}
                </Button>
              </div>
              {urlError && (
                <p className="text-sm text-red-600 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {urlError}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Document List */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dokumente ({docs.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Laden...
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">Noch keine Dokumente hochgeladen.</p>
            </div>
          ) : (
            <div className="divide-y">
              {docs.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
                >
                  {doc.sourceUrl ? (
                    <Globe className="w-5 h-5 text-muted-foreground shrink-0" />
                  ) : (
                    <FileText className="w-5 h-5 text-muted-foreground shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{doc.title}</p>
                    {doc.sourceUrl ? (
                      <p className="text-xs text-muted-foreground truncate">
                        <a
                          href={doc.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {doc.sourceUrl}
                        </a>
                        {" · "}
                        {new Date(doc.createdAt).toLocaleDateString("de-DE")}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground truncate">
                        {doc.filename} · {formatBytes(doc.size)} ·{" "}
                        {new Date(doc.createdAt).toLocaleDateString("de-DE")}
                      </p>
                    )}
                    {doc.status === "error" && doc.errorMessage && (
                      <p className="text-xs text-red-600 mt-0.5">
                        {doc.errorMessage}
                      </p>
                    )}
                  </div>
                  <StatusBadge status={doc.status} chunkCount={doc.chunkCount} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => deleteMutation.mutate(doc.id)}
                    disabled={deleteMutation.isPending}
                    title="Dokument löschen"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
