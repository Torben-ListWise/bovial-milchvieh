# Bovial — Project State (Stand: 20. Juli 2026)

## Verifiziert (per Code-/DB-Beleg bestätigt)
- Produktname: Bovial (bestätigt über Apple Developer Identifiers com.bovial.app, Login-Screens)
- Tech-Stack: Replit, React, Tailwind, Anthropic API, PostgreSQL + pgvector
- DairyComp-Glossar: Root-Cause-Historie — 1) status='error' bei dairycomp_glossar behoben, 2) document_type war NULL, behoben, 3) Klartext-Synonyme fehlten teilweise, Audit beauftragt. Bei jedem neuen Glossar-Problem: erst DB-Status prüfen, nicht direkt Prompt-Logik vermuten.
- Rate-Limiting: vor kurzem ergänzt (Burst-Grenze pro Nutzer zusätzlich zum Monatskontingent) — Status nach Einführung noch nicht erneut verifiziert.
- Team-Einladung: Endpoint existiert bereits (Einladen/Entfernen von bis zu 3 Mitgliedern), kein automatischer E-Mail-Versand — Link muss vom Inhaber manuell geteilt werden.
- Betriebs-Kontext-Speicher: existiert bereits (context_facts-Tabelle, Bestätigungs-UI auf Startseite) — war zum Prüfzeitpunkt bereits vollständig umgesetzt.
- Admin-Wissensmanager: existiert bereits unter /operator/... (nicht /admin/...).
- Navigationsumbau Pill+Dropdown: umgesetzt am 20.07.2026 — AnalysisHistoryPanel in analyses.tsx ersetzt durch AnalysisSwitcherPill (kompakte Pill-Bar + Portal-Dropdown), mobile ChatScreen erhält Custom-Header mit Pill + BottomSheetModal als Analyses-Picker.

## Bekanntes Muster — Vorsicht bei "Fertig"-Meldungen
Mehrfach hat eine erste "✅ Fertig"-Antwort sich bei genauerer Nachfrage als falsch oder nur teilweise erledigt herausgestellt (Beispiele: Antwortlängen-Regel initial an falscher Stelle eingefügt, Chip-Rotation durch späteren Commit regressiert, Streaming-Fix mehrfach nötig). Regel für künftige Sessions: Nach jedem Task IMMER mit konkretem Beleg (Dateiname, Zeile, Testergebnis) nachfragen, nie eine reine Bestätigung ohne Beleg akzeptieren.

## Aktuelles Preismodell (Stand dieser Planung, ersetzt alte Free/Starter/Pro-Struktur)
- Basis: 1,99 €/Monat, 15 Credits, 1 Nutzer (kein "kostenlos"-Label, kostenpflichtig!)
- Professional: 19 €/Monat, 60 Credits, 1 Nutzer
- Premium: 49 €/Monat, 200 Credits, bis 3 Nutzer
- Premium Max: 99 €/Monat, "unbegrenzt" nach außen, stille Fair-Use-Grenze ~1.500 Credits intern
- Credit-Gewichtung: einfache Analyse = 1, komplexe Analyse = 3, Kalkulator/Multi-Turn = 5; reine Chat-/Wissensfragen = 0 Credits (unbegrenzt)
- 2-Wochen-Trial mit Professional-Funktionsumfang, automatischer Übergang in Bezahlabo, Pflicht-Transparenz "Heute 0 €" vor Abschluss, Kündigungsbutton via Stripe Customer Portal (§ 312k BGB)
- STATUS: Als Task gesendet, Umsetzung inkl. Stripe-Anbindung noch nicht vollständig verifiziert. Vor Livegang: Anwalt-Review des Trial-/Kündigungsflows empfohlen.

## Unternehmensstruktur
- Holding: Torben Richelsen Software UG (haftungsbeschränkt), hält Bovial und ListWise
- Betreiber Bovial: Torben Richelsen, Hörpeler Weg 14a, 21272 Egestorf

## Als Task gesendet, NICHT erneut verifiziert (Vorsicht bei Annahme "erledigt")
- SSE-Streaming-Fixes (mehrfach iteriert, letzter Stand unklar ob vollständig stabil)
- emit_chart-Grounding-Logik-Test (Verdacht: Charts feuern evtl. seltener als vorgeschrieben)
- Dynamische Zwischenschritt-Beschreibungen (Vorlagen-basiert, kein Zusatz-LLM-Call)
- Referenzanalysen-Upload-Bereich (dreigeteilte Extraktion: Befehl/Muster/Einstufung ohne Rohzahlen)
- Themengrenze Patch Q (nur Milchvieh/angrenzender Ackerbau/Betriebswirtschaft)
- Onboarding-Umbau (automatische KPI-Übersicht nach erstem Upload ersetzt generisches Onboarding)
- iOS-Build: Signing-Fix bestätigt erfolgreich, SPM/Clerk-Fix gesendet aber nächster Codemagic-Build nicht verifiziert
- Credit-Verbrauchs-Dashboard (Admin-Tool zur Validierung der 1/3/5-Gewichtung)

## Nur geplant, NICHT an Replit gesendet
- Betrieb-vs-Standort-Datenmodell (mehrere Standorte pro Lizenz) — bewusst zurückgestellt
- Berater-Modul komplett (Preismodell Grundgebühr+pro Betrieb, eigene Wissensschicht, Eskalation an Berater, Berater-Verzeichnis) — Konzept steht, Umsetzung erst nach Beta-Validierung
- DDW als Auftragsverarbeiter in Datenschutzerklärung — bewusst zurückgestellt

## Vision & Mission
- Vision: "Kein landwirtschaftlicher Betrieb muss auf den nächsten Beratertermin warten, um zu verstehen, was in seinen eigenen Daten steckt — wir beginnen bei den Milchviehbetrieben, weil dort die Datenlage am reifsten ist."
- Mission: "Wir übersetzen die Auswertungen jedes Milchviehbetriebs — aus DairyComp, PDF, Excel oder einem Foto vom Ausdruck — in verständliche, belegte Antworten, denen ein Landwirt vertrauen kann, weil wir nie eine Zahl behaupten, die wir nicht zeigen können."

## Größter offener Risikofaktor
Null Beta-Tester bisher. Alle Preis-, Feature- und Positionierungsentscheidungen sind bislang unvalidiert.

## Geplante Infrastruktur-Migration (nach UG-Notartermin)
Ziel: Produktions-App von Replit-Hosting auf Hetzner (EU-Anbieter, DSGVO-Datenresidenz) migrieren. Replit bleibt Entwicklungsumgebung (Code-Bearbeitung, Agent-Tasks), Deployment läuft künftig über Hetzner statt Replit Deployments — analog zum bestehenden Muster bei bovial-mobile (Replit bearbeitet Code → pusht nach GitHub → Codemagic baut/deployed), nur mit Hetzner statt Codemagic als Zielsystem.

STATUS: Wartet bewusst auf Abschluss des UG-Notartermins, damit der Hetzner-Vertrag direkt auf die Firma statt privat abgeschlossen wird (vermeidet spätere Vertragsumschreibung).

Nötige Schritte nach Notartermin:
1. Hetzner-Server bestellen (Firmenkonto, sobald UG im Handelsregister)
2. Laufzeitumgebung einrichten (Node.js, PostgreSQL + pgvector-Erweiterung)
3. Deployment-Automatisierung: automatischer Pull/Build bei jedem GitHub-Push
4. Datenbank-Migration von Replit-Postgres zu Hetzner-Postgres
5. Secrets/Umgebungsvariablen (Anthropic-API-Key, Stripe, Clerk, Resend) übertragen
6. DNS-Umstellung bovial.com auf Hetzner-Server-IP, SSL-Zertifikat (Let's Encrypt)

Grund für Timing: Migration jetzt (vor echten Nutzerdaten) ist risikoärmer als später, aber Vertragsabschluss vor UG-Eintragung würde zu doppelter Vertragsarbeit führen (Umschreibung auf Firma nötig). Daher bewusst kombiniert: Migration technisch vorbereiten/planen jederzeit möglich, Vertragsabschluss erst nach Notartermin.
