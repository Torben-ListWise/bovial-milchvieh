import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function AGBPage() {
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
          <h1 className="text-4xl font-bold text-foreground">Allgemeine Geschäftsbedingungen (AGB)</h1>
          <p className="text-sm text-muted-foreground mt-2">Stand: 26. Juni 2026</p>
        </div>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 1 Geltungsbereich und Anbieter</h2>
          <p className="text-muted-foreground leading-relaxed">
            Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Verträge zwischen
            <strong className="text-foreground"> Torben Richelsen, Bovial, Hörpeler Weg 14a, 21272 Egestorf</strong>
            {" "}(nachfolgend „Anbieter") und den Nutzern des Dienstes „Milchvieh Assistent"
            (nachfolgend „Dienst"), der unter <strong className="text-foreground">www.bovial.com</strong> erreichbar ist.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Abweichende Bedingungen des Nutzers werden nicht anerkannt, es sei denn, der Anbieter stimmt
            ihrer Geltung ausdrücklich schriftlich zu.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 2 Vertragsschluss</h2>
          <p className="text-muted-foreground leading-relaxed">
            Die Präsentation des Dienstes auf der Website stellt kein rechtlich bindendes Angebot dar,
            sondern eine Aufforderung zur Abgabe eines Angebots (invitatio ad offerendum).
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Durch die Registrierung eines Nutzerkontos und — sofern kostenpflichtige Tarife gewählt werden —
            durch die Bestätigung des Bezahlvorgangs gibt der Nutzer ein verbindliches Angebot zum
            Vertragsschluss ab. Der Vertrag kommt mit der Freischaltung des Zugangs durch den Anbieter
            oder der Bestätigungs-E-Mail zustande.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Vor dem Abschluss eines kostenpflichtigen Abonnements werden dem Nutzer alle wesentlichen
            Vertragsbestandteile (Leistungsumfang, Preis inkl. Mehrwertsteuer, Laufzeit,
            Kündigungsmodalitäten) auf der Bestellseite angezeigt. Der Nutzer muss seine Zustimmung
            zu diesen AGB und zur Datenschutzerklärung durch Ankreuzen einer Checkbox ausdrücklich bestätigen.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 3 Leistungsbeschreibung</h2>
          <p className="text-muted-foreground leading-relaxed">
            Der Dienst „Milchvieh Assistent" ermöglicht Nutzern, landwirtschaftliche Betriebsdaten
            (z. B. Tabellendateien aus LKV-Auswertungen, Milchleistungsdaten, Herdendaten) hochzuladen
            und mittels KI-gestützter Analyse (Anthropic Claude) auszuwerten. Die Ergebnisse werden
            als KI-generierte Textantworten und Visualisierungen bereitgestellt.
          </p>
          <div className="space-y-3">
            <p className="text-muted-foreground font-medium">Analyse-Kontingente je Tarif:</p>
            <div className="border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Tarif</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Analysen / Monat</th>
                    <th className="text-left px-4 py-3 font-semibold text-foreground">Preis / Monat (inkl. 19 % MwSt.)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-4 py-3 text-foreground">Kostenlos (Free)</td>
                    <td className="px-4 py-3 text-muted-foreground">10 Analysen</td>
                    <td className="px-4 py-3 text-muted-foreground">0,00 €</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-foreground">Starter</td>
                    <td className="px-4 py-3 text-muted-foreground">50 Analysen</td>
                    <td className="px-4 py-3 text-muted-foreground">19,00 €</td>
                  </tr>
                  <tr>
                    <td className="px-4 py-3 text-foreground">Pro</td>
                    <td className="px-4 py-3 text-muted-foreground">Unbegrenzt, bis zu 3 Team-Einladungen inklusive</td>
                    <td className="px-4 py-3 text-muted-foreground">49,00 €</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-muted-foreground text-sm">
              Alle Preise verstehen sich inklusive der gesetzlichen Mehrwertsteuer (19 %).
              Alle Tarife sind monatlich kündbar, es besteht keine Jahresbindung.
            </p>
          </div>
          <p className="text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Fair-Use-Klausel (Pro-Tarif):</strong>{" "}
            Bei deutlich überdurchschnittlicher Nutzung im Pro-Tarif, insbesondere bei durchgehend
            komplexen, ressourcenintensiven Analysen weit über dem für diese Preisstufe kalkulierten
            Durchschnitt, behält sich der Anbieter vor, ein angemessenes zusätzliches Nutzungsentgelt
            zu vereinbaren oder die Nutzung in zumutbarem Rahmen zu drosseln.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Der Anbieter behält sich vor, den Leistungsumfang angemessen zu ändern, sofern dies dem Nutzer
            mit einer Frist von mindestens 30 Tagen mitgeteilt wird.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 4 Laufzeit und Kündigung</h2>
          <p className="text-muted-foreground leading-relaxed">
            Kostenpflichtige Abonnements werden monatlich abgeschlossen und verlängern sich automatisch
            um jeweils einen Monat, wenn sie nicht bis spätestens zum letzten Tag des laufenden
            Abrechnungszeitraums gekündigt werden.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Die Kündigung ist jederzeit über die Kontoeinstellungen oder per E-Mail an
            {" "}<a href="mailto:[IHRE-EMAIL@DOMAIN.DE]" className="text-primary hover:underline">[IHRE-EMAIL@DOMAIN.DE]</a>{" "}
            möglich. Nach Kündigung bleibt der Zugang bis zum Ende des bezahlten Zeitraums bestehen.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Das Recht zur außerordentlichen Kündigung aus wichtigem Grund bleibt unberührt. Ein wichtiger
            Grund liegt insbesondere vor, wenn der Nutzer gegen diese AGB verstößt oder den Dienst missbräuchlich
            verwendet.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 5 Widerrufsrecht für Verbraucher</h2>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
            <p className="text-amber-800 leading-relaxed text-sm">
              Diese Widerrufsbelehrung gilt nur für Verbraucher im Sinne des § 13 BGB. Da sich das Angebot
              an landwirtschaftliche Betriebe richtet, die in der Regel als Unternehmer im Sinne des § 14 BGB
              handeln, besteht für diese kein gesetzliches Widerrufsrecht.
            </p>
            <p className="font-semibold text-amber-900">Widerrufsbelehrung</p>
            <p className="text-amber-800 leading-relaxed text-sm">
              <strong>Widerrufsrecht:</strong> Sie haben das Recht, binnen 14 Tagen ohne Angabe von Gründen
              diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt 14 Tage ab dem Tag des Vertragsabschlusses.
            </p>
            <p className="text-amber-800 leading-relaxed text-sm">
              Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (<strong>Torben Richelsen,
              Hörpeler Weg 14a, 21272 Egestorf, E-Mail: t_richelsen@hotmail.de</strong>) mittels einer eindeutigen Erklärung
              (z. B. per E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren.
            </p>
            <p className="text-amber-800 leading-relaxed text-sm">
              Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung
              des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.
            </p>
            <p className="font-semibold text-amber-900 text-sm">Vorzeitiges Erlöschen des Widerrufsrechts:</p>
            <p className="text-amber-800 leading-relaxed text-sm">
              Bei einem Vertrag über die Lieferung von digitalen Inhalten, die nicht auf einem körperlichen
              Datenträger geliefert werden, erlischt das Widerrufsrecht vorzeitig, wenn der Anbieter mit
              der Ausführung des Vertrags begonnen hat, nachdem der Verbraucher ausdrücklich zugestimmt hat,
              dass der Anbieter mit der Ausführung des Vertrags vor Ablauf der Widerrufsfrist beginnt, und
              seine Kenntnis davon bestätigt hat, dass er durch seine Zustimmung mit Beginn der Ausführung
              des Vertrags sein Widerrufsrecht verliert. Durch die Bestätigung der Checkbox „Ich stimme zu,
              dass der Dienst sofort freigeschaltet wird, und verzichte damit auf mein Widerrufsrecht" beim
              Checkout verliert der Verbraucher sein Widerrufsrecht mit dem Beginn der Nutzung.
            </p>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 6 Pflichten des Nutzers</h2>
          <p className="text-muted-foreground leading-relaxed">
            Der Nutzer verpflichtet sich, nur Daten hochzuladen, über die er die erforderlichen Rechte verfügt,
            und keine personenbezogenen Daten Dritter ohne entsprechende Rechtsgrundlage einzureichen.
            Der Dienst darf nicht für rechtswidrige Zwecke genutzt werden.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Der Nutzer ist verantwortlich für die Richtigkeit und Vollständigkeit der hochgeladenen Daten.
            Die KI-gestützten Analysen basieren ausschließlich auf den vom Nutzer bereitgestellten Daten.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 7 Haftungsbeschränkung für KI-generierte Inhalte</h2>
          <p className="text-muted-foreground leading-relaxed">
            Die durch den Dienst bereitgestellten Analyseergebnisse werden von einem KI-Sprachmodell
            (Anthropic Claude) generiert. Sie stellen eine Entscheidungshilfe dar, ersetzen jedoch keine
            professionelle landwirtschaftliche, rechtliche, steuerliche oder veterinärmedizinische Beratung.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Der Anbieter übernimmt keine Haftung für die inhaltliche Richtigkeit, Vollständigkeit oder
            Aktualität der KI-generierten Analyseergebnisse. Eine Haftung für Schäden, die durch
            Entscheidungen auf Basis der Analyseergebnisse entstehen, ist ausgeschlossen, soweit der
            Anbieter nicht vorsätzlich oder grob fahrlässig gehandelt hat.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie
            die Haftung nach dem Produkthaftungsgesetz bleibt unberührt.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 8 Verfügbarkeit</h2>
          <p className="text-muted-foreground leading-relaxed">
            Der Anbieter bemüht sich um eine hohe Verfügbarkeit des Dienstes, übernimmt jedoch keine
            Garantie für ununterbrochene Verfügbarkeit. Wartungsarbeiten, technische Störungen sowie
            Ausfälle bei Drittanbietern (insbesondere Anthropic, Clerk, Stripe) können zu temporären
            Einschränkungen führen.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 9 Datenschutz</h2>
          <p className="text-muted-foreground leading-relaxed">
            Informationen zur Verarbeitung personenbezogener Daten entnehmen Sie bitte unserer{" "}
            <Link href="/datenschutz" className="text-primary hover:underline">Datenschutzerklärung</Link>.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 10 Anwendbares Recht und Gerichtsstand</h2>
          <p className="text-muted-foreground leading-relaxed">
            Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts (CISG).
            Für Verbraucher gilt diese Rechtswahl nur, soweit dadurch nicht zwingende Schutzvorschriften
            des Rechts des gewöhnlichen Aufenthaltsstaats des Verbrauchers eingeschränkt werden.
          </p>
          <p className="text-muted-foreground leading-relaxed">
            Für Kaufleute, juristische Personen des öffentlichen Rechts oder öffentlich-rechtliche
            Sondervermögen ist, soweit gesetzlich zulässig, ausschließlicher Gerichtsstand für alle
            Streitigkeiten aus diesem Vertragsverhältnis{" "}
            <strong className="text-foreground">Egestorf</strong>.
            Diese Gerichtsstandsvereinbarung gilt ausschließlich im Verhältnis zu Unternehmern;
            gegenüber Verbrauchern ist sie nach § 38 ZPO grundsätzlich unwirksam.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 11 Änderungen der AGB</h2>
          <p className="text-muted-foreground leading-relaxed">
            Der Anbieter behält sich vor, diese AGB mit einer Ankündigungsfrist von mindestens 30 Tagen
            vor dem Inkrafttreten zu ändern. Die Änderungen werden dem Nutzer per E-Mail oder über eine
            Benachrichtigung im Dienst mitgeteilt. Widerspricht der Nutzer nicht innerhalb von 30 Tagen,
            gelten die neuen AGB als angenommen. Auf das Widerspruchsrecht und die Folgen eines
            Schweigens wird in der Änderungsmitteilung gesondert hingewiesen.
          </p>
        </section>

        <section className="space-y-4">
          <h2 className="text-2xl font-semibold text-foreground">§ 12 Salvatorische Klausel</h2>
          <p className="text-muted-foreground leading-relaxed">
            Sollten einzelne Bestimmungen dieser AGB unwirksam oder undurchführbar sein oder nach
            Vertragsschluss unwirksam oder undurchführbar werden, bleibt die Wirksamkeit der übrigen
            Bestimmungen unberührt.
          </p>
        </section>

        <div className="pt-8 border-t border-border text-sm text-muted-foreground">
          Stand: 26. Juni 2026
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
