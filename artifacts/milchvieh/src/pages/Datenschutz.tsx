import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function DatenschutzPage() {
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

      <main className="max-w-3xl mx-auto px-6 py-12 space-y-10">
        <div>
          <h1 className="text-4xl font-bold text-foreground">Datenschutzerklärung</h1>
          <p className="text-sm text-muted-foreground mt-2">Stand: [DATUM DES INKRAFTTRETENS]</p>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">1. Verantwortlicher</h2>
          <p className="text-muted-foreground leading-relaxed">
            Verantwortlicher im Sinne der Datenschutz-Grundverordnung (DSGVO) und anderer nationaler
            Datenschutzgesetze sowie sonstiger datenschutzrechtlicher Bestimmungen ist:
          </p>
          <div className="bg-muted/30 rounded-lg p-4 text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">[IHR NAME / FIRMENNAME]</p>
            <p>[IHRE STRASSE UND HAUSNUMMER]</p>
            <p>[IHR PLZ UND ORT]</p>
            <p>Deutschland</p>
            <p>E-Mail: <a href="mailto:[IHRE-EMAIL@DOMAIN.DE]" className="text-primary hover:underline">[IHRE-EMAIL@DOMAIN.DE]</a></p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">2. Arten der verarbeiteten Daten</h2>
          <ul className="text-muted-foreground space-y-2 list-disc list-inside leading-relaxed">
            <li>Kontaktdaten (E-Mail-Adresse, Name)</li>
            <li>Zugangsdaten (verschlüsselte Passwörter, Sitzungstoken)</li>
            <li>Hochgeladene Betriebsdaten (Tabellendateien, Milchleistungsdaten, Herdendaten)</li>
            <li>Analyseergebnisse und Gesprächsverläufe mit dem KI-Assistenten</li>
            <li>Nutzungsdaten (Zeitpunkte von Logins, Upload-Aktivitäten)</li>
            <li>Zahlungsdaten (werden ausschließlich über Stripe verarbeitet, nicht auf unseren Servern gespeichert)</li>
          </ul>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">3. Zwecke und Rechtsgrundlagen der Verarbeitung</h2>
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Zweck</th>
                  <th className="text-left px-4 py-3 font-semibold text-foreground">Rechtsgrundlage</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border text-muted-foreground">
                <tr>
                  <td className="px-4 py-3">Vertragserfüllung (Bereitstellung des Dienstes)</td>
                  <td className="px-4 py-3">Art. 6 Abs. 1 lit. b DSGVO</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Nutzerauthentifizierung</td>
                  <td className="px-4 py-3">Art. 6 Abs. 1 lit. b DSGVO</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">KI-Analyse der Betriebsdaten</td>
                  <td className="px-4 py-3">Art. 6 Abs. 1 lit. b DSGVO</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Zahlungsabwicklung</td>
                  <td className="px-4 py-3">Art. 6 Abs. 1 lit. b DSGVO</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Transaktions-E-Mails (Bestätigungen, Rechnungen)</td>
                  <td className="px-4 py-3">Art. 6 Abs. 1 lit. b DSGVO</td>
                </tr>
                <tr>
                  <td className="px-4 py-3">Einhaltung gesetzlicher Aufbewahrungspflichten</td>
                  <td className="px-4 py-3">Art. 6 Abs. 1 lit. c DSGVO</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">4. Drittanbieter und Auftragsverarbeiter</h2>
          <p className="text-muted-foreground leading-relaxed">
            Wir setzen folgende Drittanbieter ein, mit denen wir Auftragsverarbeitungsverträge (AVV)
            nach Art. 28 DSGVO abgeschlossen haben oder abschließen werden:
          </p>

          <div className="space-y-4">
            <div className="border border-border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-foreground">a) Clerk (Nutzerauthentifizierung)</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Clerk, Inc., 548 Market St PMB 33580, San Francisco, CA 94104, USA. Verarbeitung: E-Mail-Adresse,
                Name, Passwort (verschlüsselt), Sitzungstoken. Übermittlung in die USA auf Basis von
                Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO).
              </p>
              <a href="https://clerk.com/legal/dpa" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline text-sm">
                Clerk DPA (Auftragsverarbeitungsvertrag) →
              </a>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-foreground">b) Anthropic (KI-Analyse)</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Anthropic, PBC, 548 Market St PMB 61220, San Francisco, CA 94104, USA. Verarbeitung:
                Hochgeladene Betriebsdaten und Gesprächsinhalte werden zur KI-Analyse an Anthropic übermittelt.
                Übermittlung in die USA auf Basis von Standardvertragsklauseln (Art. 46 Abs. 2 lit. c DSGVO).
                Anthropic gibt an, Kundendaten nicht für das Training von Modellen zu verwenden (vorbehaltlich
                der gültigen Nutzungsbedingungen).
              </p>
              <a href="https://privacy.anthropic.com/en/data-processing-addendum" target="_blank"
                rel="noopener noreferrer" className="text-primary hover:underline text-sm">
                Anthropic DPA (Auftragsverarbeitungsvertrag) →
              </a>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-foreground">c) Replit / Hetzner (Hosting &amp; Speicherung)</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Die Anwendung wird auf der Plattform Replit (Replit, Inc., 855 El Camino Real Ste 13A-199,
                Palo Alto, CA 94301, USA) gehostet. Datenbankdienste und Objektspeicherung können über
                Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, Deutschland oder andere
                Infrastrukturanbieter betrieben werden.
              </p>
              <a href="https://hetzner.com/legal/privacy-policy" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline text-sm">
                Hetzner Datenschutz / AVV →
              </a>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-foreground">d) Stripe (Zahlungsabwicklung)</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Stripe, Inc., 510 Townsend Street, San Francisco, CA 94103, USA (bzw. Stripe Payments Europe
                Ltd. für europäische Nutzer). Verarbeitung: Zahlungsdaten (Kreditkarte, IBAN etc.),
                Rechnungsanschrift. Wir erhalten keine vollständigen Zahlungsdaten; diese werden direkt
                bei Stripe gespeichert.
              </p>
              <a href="https://stripe.com/de/legal/dpa" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline text-sm">
                Stripe DPA (Auftragsverarbeitungsvertrag) →
              </a>
            </div>

            <div className="border border-border rounded-lg p-4 space-y-2">
              <h3 className="font-semibold text-foreground">e) Resend (E-Mail-Versand)</h3>
              <p className="text-muted-foreground text-sm leading-relaxed">
                Resend, Inc., 2261 Market Street, Suite 5039, San Francisco, CA 94114, USA. Verarbeitung:
                E-Mail-Adresse für den Versand von Transaktions-E-Mails (Bestätigungen, Warnmeldungen).
              </p>
              <a href="https://resend.com/legal/dpa" target="_blank" rel="noopener noreferrer"
                className="text-primary hover:underline text-sm">
                Resend DPA (Auftragsverarbeitungsvertrag) →
              </a>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">5. Grenzüberschreitende Datenübermittlung</h2>
          <p className="text-muted-foreground leading-relaxed">
            Mehrere der genannten Drittanbieter (insbesondere Anthropic, Clerk, Stripe, Resend) haben ihren
            Sitz in den USA. Die Übermittlung personenbezogener Daten in die USA erfolgt auf Basis der
            Standardvertragsklauseln der Europäischen Kommission gemäß Art. 46 Abs. 2 lit. c DSGVO, da
            die USA kein der EU vergleichbares Datenschutzniveau gesetzlich garantieren.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Kopien der Standardvertragsklauseln können beim Anbieter auf Anfrage angefordert werden.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">6. Cookies</h2>
          <p className="text-muted-foreground leading-relaxed">
            Diese Website verwendet ausschließlich technisch notwendige Cookies, die für den Betrieb
            des Dienstes erforderlich sind (z. B. Sitzungs-Cookies für die Anmeldung). Es werden
            keine Tracking-Cookies, Werbe-Cookies oder Cookies von Drittanbietern zu Analysezwecken
            eingesetzt.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Technisch notwendige Cookies können in Ihrem Browser nicht deaktiviert werden, ohne die
            Funktionsfähigkeit des Dienstes zu beeinträchtigen.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">7. Speicherdauer</h2>
          <p className="text-muted-foreground leading-relaxed">
            Personenbezogene Daten werden gelöscht, sobald der Zweck der Verarbeitung entfällt und
            keine gesetzlichen Aufbewahrungspflichten entgegenstehen. Für Rechnungen und
            Zahlungsbelege gilt eine Aufbewahrungspflicht von 10 Jahren (§ 147 AO).
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Nach Konto-Löschung werden alle hochgeladenen Dateien und Analysedaten innerhalb von
            30 Tagen unwiderruflich gelöscht.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">8. Ihre Rechte als betroffene Person</h2>
          <p className="text-muted-foreground leading-relaxed">
            Sie haben gemäß DSGVO folgende Rechte:
          </p>
          <ul className="text-muted-foreground space-y-2 list-disc list-inside leading-relaxed">
            <li><strong className="text-foreground">Auskunftsrecht</strong> (Art. 15 DSGVO): Sie können Auskunft über die über Sie gespeicherten Daten verlangen.</li>
            <li><strong className="text-foreground">Berichtigung</strong> (Art. 16 DSGVO): Sie können die Berichtigung unrichtiger Daten verlangen.</li>
            <li><strong className="text-foreground">Löschung</strong> (Art. 17 DSGVO): Sie können die Löschung Ihrer Daten verlangen. Die Löschung ist direkt über die Kontoeinstellungen möglich.</li>
            <li><strong className="text-foreground">Einschränkung</strong> (Art. 18 DSGVO): Sie können die Einschränkung der Verarbeitung verlangen.</li>
            <li><strong className="text-foreground">Datenportabilität</strong> (Art. 20 DSGVO): Sie können Ihre Daten in maschinenlesbarem Format exportieren. Der Datenexport ist direkt über die Kontoeinstellungen möglich.</li>
            <li><strong className="text-foreground">Widerspruch</strong> (Art. 21 DSGVO): Sie können der Verarbeitung widersprechen.</li>
          </ul>
          <p className="text-muted-foreground leading-relaxed">
            Den Datenexport und die Konto-Löschung können Sie direkt in den{" "}
            <strong>Einstellungen</strong> Ihres Kontos unter „Einstellungen &amp; DSGVO" vornehmen.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Zur Ausübung Ihrer Rechte wenden Sie sich an:{" "}
            <a href="mailto:[IHRE-EMAIL@DOMAIN.DE]" className="text-primary hover:underline">[IHRE-EMAIL@DOMAIN.DE]</a>
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">9. Beschwerderecht</h2>
          <p className="text-muted-foreground leading-relaxed">
            Sie haben das Recht, sich bei einer Datenschutz-Aufsichtsbehörde zu beschweren, wenn Sie
            der Ansicht sind, dass die Verarbeitung Ihrer personenbezogenen Daten gegen die DSGVO verstößt.
            Zuständig ist die Datenschutz-Aufsichtsbehörde Ihres Bundeslandes oder die des Bundeslandes,
            in dem der Verantwortliche seinen Sitz hat.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Eine Liste der Aufsichtsbehörden finden Sie unter:{" "}
            <a href="https://www.bfdi.bund.de/DE/Infothek/Anschriften_Links/anschriften_links-node.html"
              target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
              BfDI – Aufsichtsbehörden →
            </a>
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">10. KI-Transparenz (EU AI Act)</h2>
          <p className="text-muted-foreground leading-relaxed">
            Dieser Dienst setzt ein KI-Sprachmodell (Anthropic Claude) ein, das Analyseergebnisse
            automatisch generiert. Gemäß Art. 50 EU AI Act werden Nutzer darüber informiert, dass
            sie mit einem KI-System interagieren. Entsprechende Hinweise sind in der Analyse-Oberfläche
            dauerhaft sichtbar.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            KI-generierte Inhalte können Fehler enthalten und stellen keine professionelle Beratung dar.
            Jede Analyse-Antwort enthält einen entsprechenden Transparenzhinweis.
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
