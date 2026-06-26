import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function ImpressumPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8" />
          <span className="font-bold text-lg text-primary">Bovial</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <div>
          <h1 className="text-4xl font-bold text-foreground">Impressum</h1>
          <p className="text-sm text-muted-foreground mt-2">Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz)</p>
        </div>

        <section className="space-y-2">
          <p className="font-semibold text-foreground">Torben Richelsen</p>
          <p className="text-muted-foreground">Bovial</p>
          <p className="text-muted-foreground">Hörpeler Weg 14a</p>
          <p className="text-muted-foreground">21272 Egestorf</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Kontakt</h2>
          <div className="text-muted-foreground space-y-1">
            <p>Telefon: 0175 4319623</p>
            <p>E-Mail: <a href="mailto:t_richelsen@hotmail.de" className="text-primary hover:underline">t_richelsen@hotmail.de</a></p>
          </div>
        </section>

        <section className="space-y-6">
          <h2 className="text-xl font-semibold text-foreground">Haftungsausschluss</h2>

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Haftung für Inhalte</h3>
            <p className="text-muted-foreground leading-relaxed">
              Die Inhalte dieser Seiten wurden mit größter Sorgfalt erstellt. Für die Richtigkeit,
              Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.
              Als Diensteanbieter sind wir gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten
              nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 DDG sind wir als
              Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde
              Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige
              Tätigkeit hinweisen. Eine Haftung ist erst ab dem Zeitpunkt der Kenntnis einer konkreten
              Rechtsverletzung möglich. Bei Bekanntwerden entsprechender Rechtsverletzungen werden
              diese Inhalte umgehend entfernt.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Haftung für Links</h3>
            <p className="text-muted-foreground leading-relaxed">
              Unser Angebot enthält gegebenenfalls Links zu externen Webseiten Dritter, auf deren
              Inhalte wir keinen Einfluss haben. Für diese fremden Inhalte können wir keine Gewähr
              übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter
              verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf mögliche
              Rechtsverstöße überprüft, eine permanente inhaltliche Kontrolle ist ohne konkrete
              Anhaltspunkte nicht zumutbar. Bei Bekanntwerden von Rechtsverletzungen werden derartige
              Links umgehend entfernt.
            </p>
          </div>

          <div className="space-y-2">
            <h3 className="font-semibold text-foreground">Urheberrecht</h3>
            <p className="text-muted-foreground leading-relaxed">
              Die durch den Betreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem
              deutschen Urheberrecht. Vervielfältigung, Bearbeitung, Verbreitung und jede Art der
              Verwertung außerhalb der Grenzen des Urheberrechts bedürfen der schriftlichen Zustimmung
              des jeweiligen Erstellers. Soweit Inhalte auf dieser Seite nicht vom Betreiber erstellt
              wurden, werden die Urheberrechte Dritter beachtet. Bei Hinweisen auf Rechtsverletzungen
              werden entsprechende Inhalte umgehend entfernt.
            </p>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card mt-12">
        <div className="max-w-3xl mx-auto px-6 py-6 flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link href="/impressum" className="hover:text-foreground transition-colors">Impressum</Link>
          <Link href="/agb" className="hover:text-foreground transition-colors">AGB</Link>
          <Link href="/datenschutz" className="hover:text-foreground transition-colors">Datenschutz</Link>
        </div>
      </footer>
    </div>
  );
}
