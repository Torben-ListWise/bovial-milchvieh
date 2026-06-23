import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function ImpressumPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="flex items-center justify-between px-6 py-4 border-b bg-card sticky top-0 z-10">
        <div className="flex items-center gap-3">
          <img src={`${basePath}/logo.svg`} alt="Logo" className="w-8 h-8" />
          <span className="font-bold text-lg text-primary">Milchvieh Assistent</span>
        </div>
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Zurück
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-8">
        <h1 className="text-4xl font-bold text-foreground">Impressum</h1>
        <p className="text-sm text-muted-foreground">Angaben gemäß § 5 TMG</p>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Anbieter</h2>
          <div className="text-muted-foreground leading-relaxed space-y-1">
            <p className="font-medium text-foreground">[IHR NAME / FIRMENNAME]</p>
            <p>[IHRE STRASSE UND HAUSNUMMER]</p>
            <p>[IHR PLZ UND ORT]</p>
            <p>Deutschland</p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Kontakt</h2>
          <div className="text-muted-foreground leading-relaxed space-y-1">
            <p>E-Mail: <a href="mailto:[IHRE-EMAIL@DOMAIN.DE]" className="text-primary hover:underline">[IHRE-EMAIL@DOMAIN.DE]</a></p>
            <p>Telefon: <span>[IHRE TELEFONNUMMER]</span></p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Verantwortliche Person</h2>
          <p className="text-muted-foreground">
            Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV:<br />
            <span className="text-foreground font-medium">[IHR VOLLSTÄNDIGER NAME]</span><br />
            [IHRE ANSCHRIFT, falls abweichend von oben]
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Umsatzsteuer-Identifikationsnummer</h2>
          <p className="text-muted-foreground">
            Sofern vorhanden: USt-IdNr. gemäß § 27a UStG: <span className="text-foreground font-medium">[IHR UST-ID, z. B. DE123456789]</span>
          </p>
          <p className="text-muted-foreground text-sm">
            Falls keine USt-ID vorhanden ist (z. B. Kleinunternehmer § 19 UStG), diesen Abschnitt bitte anpassen.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Berufsrechtliche Regelungen</h2>
          <p className="text-muted-foreground">
            Es handelt sich um einen Dienst zur digitalen Betriebsdatenanalyse für landwirtschaftliche Betriebe.
            Berufsrechtliche Regelungen im Sinne des § 5 Abs. 1 Nr. 7 TMG sind nicht einschlägig.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Zuständige Aufsichtsbehörde</h2>
          <p className="text-muted-foreground leading-relaxed">
            Als Anbieter eines Telemediendienstes unterliegen wir der allgemeinen Rechtsaufsicht.
            Eine spezifische Fachaufsicht durch eine Regulierungsbehörde besteht nicht, da es sich
            nicht um einen regulierten Bereich (z. B. Finanzdienstleistungen, Versicherungen) handelt.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Für datenschutzrechtliche Anliegen ist die zuständige Datenschutz-Aufsichtsbehörde des
            Bundeslandes <strong className="text-foreground">[IHR BUNDESLAND]</strong> verantwortlich:
          </p>
          <div className="bg-muted/30 rounded-lg p-4 text-muted-foreground space-y-1 text-sm">
            <p className="font-medium text-foreground">[NAME DER ZUSTÄNDIGEN AUFSICHTSBEHÖRDE]</p>
            <p>[ANSCHRIFT DER AUFSICHTSBEHÖRDE]</p>
            <p>[PLZ UND ORT DER AUFSICHTSBEHÖRDE]</p>
            <p>z. B. für Bayern: Bayerisches Landesamt für Datenschutzaufsicht (BayLDA), Promenade 18, 91522 Ansbach</p>
          </div>
          <p className="text-muted-foreground text-sm">
            Eine aktuelle Liste aller Datenschutz-Aufsichtsbehörden der Länder finden Sie unter:{" "}
            <a href="https://www.bfdi.bund.de/DE/Infothek/Anschriften_Links/anschriften_links-node.html"
              target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              www.bfdi.bund.de
            </a>
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Streitbeilegung</h2>
          <p className="text-muted-foreground leading-relaxed">
            Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:{" "}
            <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              https://ec.europa.eu/consumers/odr/
            </a>
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Zur Teilnahme an einem Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle
            sind wir nicht verpflichtet und nicht bereit.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Haftung für Inhalte</h2>
          <p className="text-muted-foreground leading-relaxed">
            Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach den
            allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht
            verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen
            zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            <strong>Hinweis zu KI-generierten Analysen:</strong> Die im Dienst bereitgestellten Analyseergebnisse
            werden durch KI (Anthropic Claude) generiert und dienen ausschließlich als Entscheidungshilfe.
            Sie ersetzen keine fachkundige landwirtschaftliche, rechtliche oder steuerliche Beratung.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Haftung für Links</h2>
          <p className="text-muted-foreground leading-relaxed">
            Unser Angebot enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen Einfluss haben.
            Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der
            verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold text-foreground">Urheberrecht</h2>
          <p className="text-muted-foreground leading-relaxed">
            Die durch den Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem
            deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung
            außerhalb der Grenzen des Urheberrechts bedürfen der schriftlichen Zustimmung des jeweiligen Autors
            bzw. Erstellers.
          </p>
        </section>

        <div className="pt-8 border-t border-border text-sm text-muted-foreground">
          Stand: [DATUM DES INKRAFTTRETENS]
        </div>
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
