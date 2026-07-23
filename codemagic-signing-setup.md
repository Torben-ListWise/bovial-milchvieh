# Codemagic iOS Code-Signing — Einmalige Einrichtung

Dieses Dokument beschreibt die **einmalige** Einrichtung, damit der Codemagic-Build dauerhaft funktioniert ohne dass Zertifikate immer wieder widerrufen werden müssen.

## Warum das Problem entstand

Codemagic muss beim Build ein Apple Distribution-Zertifikat in den Keychain laden. Dafür braucht es einen **stabilen RSA-Schlüssel**: Apple erstellt beim ersten Build ein Zertifikat für diesen Schlüssel und erkennt es bei allen folgenden Builds wieder. Wird jedes Mal ein neuer Schlüssel generiert, versucht Apple jedes Mal ein neues Zertifikat zu erstellen — und lehnt das nach dem 2. Zertifikat mit Fehler 409 ab.

Der bisherige Fehler: `CERTIFICATE_PRIVATE_KEY` in Codemagics iOS-Gruppe enthält keinen gültigen RSA-Schlüssel, deshalb musste ein Workaround her. Der Workaround generierte jedes Mal einen neuen Schlüssel — was das Problem erst verursacht hat.

## Einrichtung (einmalig, ca. 5 Minuten)

### 1. Stabilen RSA-Schlüssel generieren

Führe diesen Befehl in deinem Mac-Terminal aus:

```bash
openssl genrsa 2048
```

Die Ausgabe sieht so aus — das ist dein privater Schlüssel:

```
-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA...
(viele Zeilen)
...
-----END RSA PRIVATE KEY-----
```

**Kopiere die gesamte Ausgabe** (inklusive der `-----BEGIN...-----` und `-----END...-----` Zeilen).

### 2. Schlüssel in Codemagic speichern

1. Öffne Codemagic → **Teams** → dein Team → **Environment variables**
2. Wähle die Gruppe **iOS**
3. Finde den Eintrag `CERTIFICATE_PRIVATE_KEY`
4. Klicke auf **Bearbeiten** (Stift-Symbol)
5. Ersetze den aktuellen (ungültigen) Wert mit dem kopierten Schlüssel
6. Aktiviere **Secure** (damit der Wert nicht in Logs erscheint)
7. Speichern

### 3. Apple Distribution-Zertifikate widerrufen (letztes Mal)

Da der neue Schlüssel noch kein passendes Zertifikat hat, muss Apple eines erstellen dürfen:

1. Öffne https://developer.apple.com/account/resources/certificates/list
2. Filter: **Distribution**
3. Alle vorhandenen widerrufen (**Revoke**)

### 4. Build starten

Starte einen neuen Codemagic-Build. Beim ersten Mal:
- Codemagic findet kein Zertifikat für den neuen Schlüssel
- Erstellt ein neues Zertifikat bei Apple (kein 409, weil du gerade alle widerrufen hast)
- Build läuft durch

**Ab dem zweiten Build:**
- Codemagic findet das vorhandene Zertifikat für den gespeicherten Schlüssel
- Kein neues Zertifikat nötig
- Kein 409
- Keine manuelle Aktion mehr nötig

## Warum das dauerhaft funktioniert

```
Stabiler Schlüssel in Codemagic
         ↓
Codemagic sucht passendes Apple-Zertifikat
         ↓
Gefunden → direkt verwenden (kein neues Zertifikat)
         ↓
Build erfolgreich — für immer
```
