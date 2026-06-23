import { useState, useEffect } from "react";
import { X } from "lucide-react";

const basePath = (import.meta as any).env.BASE_URL?.replace(/\/$/, "") ?? "";

const STORAGE_KEY = "milchvieh_cookie_notice_dismissed";

export function CookieBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setVisible(true);
      }
    } catch {
      setVisible(true);
    }
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      // ignore
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="max-w-3xl mx-auto bg-card border border-border rounded-xl shadow-lg px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-sm text-muted-foreground flex-1 leading-relaxed">
          Diese Website verwendet ausschließlich technisch notwendige Cookies, die für den Betrieb des Dienstes
          erforderlich sind. Es werden keine Tracking- oder Werbe-Cookies eingesetzt.{" "}
          <a href={`${basePath}/datenschutz`} className="text-primary hover:underline font-medium">Datenschutzerklärung</a>
        </p>
        <button
          onClick={dismiss}
          aria-label="Cookie-Hinweis schließen"
          className="shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
          Verstanden
        </button>
      </div>
    </div>
  );
}
