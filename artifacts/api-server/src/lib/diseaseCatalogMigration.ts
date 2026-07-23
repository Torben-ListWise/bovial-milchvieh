/**
 * Idempotente Migration + Seed für:
 *   1. disease_catalog Tabelle (Seuchen-Wissensbasis)
 *   2. affected_species Spalte in animal_health_alerts
 *
 * Wird beim Server-Start ausgeführt (pool.query — kein Drizzle-DDL nötig).
 */

import { pool } from "@workspace/db";
import { logger } from "./logger";

const CATALOG_SEED = [
  {
    topic_key: "MKS",
    name: "Maul- und Klauenseuche (MKS)",
    description:
      "Hochansteckende Viruserkrankung der Klauentiere. In Deutschland seit 1988 offiziell frei.",
    transmission:
      "Direktkontakt, Aerosole, kontaminierte Futtermittel, Personen und Fahrzeuge.",
    symptoms:
      "Fieber, Bläschen und Erosionen an Maul, Zunge, Klauen und Zitzen; Speichelfluss, Lahmheit.",
    prevention:
      "Strikte Biosicherheit, Einschränkung des Tierverkehrs im Seuchenfall, Impfung in Ausbruchsgebieten.",
    affected_species: ["milchvieh", "schweine", "geflügel"],
  },
  {
    topic_key: "BTV",
    name: "Blauzungenkrankheit (BTV)",
    description:
      "Viruserkrankung der Wiederkäuer, übertragen durch Stechmücken (Gnitzen). Meldepflichtig.",
    transmission:
      "Vektoren (Culicoides-Gnitzen). Kein Direktkontakt zwischen Tieren.",
    symptoms:
      "Fieber, Zyanose der Zunge, Ödeme, Lahmheit, Aborte; bei Schafen schwerer als bei Rindern.",
    prevention:
      "Impfung (Serotyp-spezifisch), Bekämpfung der Gnitzen-Vektoren, Aufstallung bei Dämmerung.",
    affected_species: ["milchvieh", "schweine"],
  },
  {
    topic_key: "ASP",
    name: "Afrikanische Schweinepest (ASP)",
    description:
      "Tödliche Viruskrankheit ausschließlich bei Haus- und Wildschweinen. In Europa weit verbreitet.",
    transmission:
      "Direktkontakt mit infizierten Tieren oder deren Blut, kontaminiertes Futter (Speisereste), Wildschweine.",
    symptoms:
      "Hohes Fieber, Blutungen, Erbrechen, Durchfall, Lethargie; Sterblichkeit nahezu 100 %.",
    prevention:
      "Kein Kontakt zu Wildschweinen, Speiseresteverbote, Zaunkontrolle, kein zugelassener Impfstoff.",
    affected_species: ["schweine"],
  },
  {
    topic_key: "KSP",
    name: "Klassische Schweinepest (KSP)",
    description:
      "Hochansteckende Virusseuche der Schweine. In deutschen Hausschweinebeständen seit 2003 frei.",
    transmission:
      "Kontakt mit erkrankten Tieren, kontaminierte Futtermittel, Wildschweine.",
    symptoms:
      "Fieber, Apathie, Bindehautentzündung, Erbrechen, Durchfall, Hautblutungen, Aborte.",
    prevention:
      "Strikte Biosicherheit, Wildschweinkontrolle, Impfung nur im Seuchenfall.",
    affected_species: ["schweine"],
  },
  {
    topic_key: "Vogelgrippe",
    name: "Aviäre Influenza (Vogelgrippe / HPAI)",
    description:
      "Hochpathogene Geflügelpest durch Influenza-A-Viren (H5Nx). Weltweit zirkulierend.",
    transmission:
      "Wildvögel, direkter Kontakt, kontaminiertes Wasser und Einstreu.",
    symptoms:
      "Plötzliche Todesfälle, Atemnot, Nervensymptome, drastischer Leistungsabfall.",
    prevention:
      "Stallpflicht bei Risikoeinschätzung, Zugangskontrolle, Desinfektion, kein Kontakt zu Wildvögeln.",
    affected_species: ["geflügel"],
  },
  {
    topic_key: "Newcastle",
    name: "Newcastle-Krankheit (ND)",
    description:
      "Hochansteckende Infektionskrankheit des Geflügels durch Paramyxovirus. Meldepflichtig.",
    transmission:
      "Direktkontakt, Aerosole, kontaminiertes Futter und Wasser.",
    symptoms:
      "Atemwegssymptome, Nervenstörungen, grüner Durchfall, Legeeinbruch.",
    prevention:
      "Impfung (Pflicht für Geflügelbestände), Biosicherheit.",
    affected_species: ["geflügel"],
  },
  {
    topic_key: "LumpySkin",
    name: "Lumpy Skin Disease (LSD)",
    description:
      "Viruserkrankung der Rinder durch Hautknoten. In Südosteuropa verbreitet, in Deutschland bislang nicht.",
    transmission:
      "Insektenvektoren (Stechmücken, Fliegen, Zecken), direkter Kontakt.",
    symptoms:
      "Fieber, multiple Hautknoten (1–5 cm), Lymphknotenschwellung, Nasen- und Augenausfluss.",
    prevention:
      "Impfung in Endemiegebieten, Insektenschutz, Einschränkung des Tierverkehrs.",
    affected_species: ["milchvieh"],
  },
  {
    topic_key: "Brucellose",
    name: "Brucellose",
    description:
      "Bakterielle Zoonose (Brucella spp.). Rinder-Brucellose in Deutschland seit 1997 frei.",
    transmission:
      "Geburtsausscheidungen, Sperma, Rohmilch; Zoonose für Menschen.",
    symptoms:
      "Aborte, Frühgeburten, Epididymitis, reduzierte Fruchtbarkeit.",
    prevention:
      "Kein Impfstoff zugelassen (EU), strenge Handelsvorschriften.",
    affected_species: ["milchvieh", "schweine"],
  },
  {
    topic_key: "Tollwut",
    name: "Tollwut",
    description:
      "Tödliche Viruserkrankung aller Warmblüter. Deutschland seit 2008 frei (Fledermäuse ausgenommen).",
    transmission:
      "Biss infizierter Tiere, Schleimhautkontakt mit Speichel.",
    symptoms:
      "Verhaltensänderungen, Aggression oder Apathie, Lähmungen, Tod.",
    prevention:
      "Impfung (bei Reisen in Endemiegebiete), keine Wildtiere anfassen.",
    affected_species: ["allgemein"],
  },
  {
    topic_key: "Schmallenberg",
    name: "Schmallenberg-Virus (SBV)",
    description:
      "Orthobunyavirus der Wiederkäuer, erstmals 2011 in Deutschland identifiziert.",
    transmission:
      "Gnitzen (Culicoides spp.) als Vektoren.",
    symptoms:
      "Missbildungen der Föten (Arthrogrypose, ZNS-Defekte), Aborte, milde Erkrankung adulter Tiere.",
    prevention:
      "Kein zugelassener Impfstoff (EU); Bekämpfung der Gnitzen.",
    affected_species: ["milchvieh"],
  },
  {
    topic_key: "RHDV",
    name: "Hämorrhagische Kaninchenkrankheit (RHDV)",
    description:
      "Hoch lethales Calicivirus bei Hauskaninchen und Wildkaninchen.",
    transmission:
      "Direktkontakt, Insekten, kontaminierte Gegenstände.",
    symptoms:
      "Plötzliche Todesfälle, Lethargie, Blutungszeichen.",
    prevention:
      "Impfung, Insektenschutz, keine Wildkaninchenkontakte.",
    affected_species: ["allgemein"],
  },
  {
    topic_key: "Hantavirus",
    name: "Hantavirus (Zoonose)",
    description:
      "Durch Nagetiere übertragenes Virus; betrifft primär Menschen in landwirtschaftlichen Umgebungen.",
    transmission:
      "Inhalation infektiöser Nagerausscheidungen (Kot, Urin, Speichel).",
    symptoms:
      "Beim Menschen: Fieber, Nieren- oder Lungenversagen.",
    prevention:
      "Nagetierbekämpfung, Schutzausrüstung bei Entrümpelung und Stallreinigung.",
    affected_species: ["allgemein"],
  },
  {
    topic_key: "Rinderpest",
    name: "Rinderpest / PPR",
    description:
      "Rinderpest weltweit ausgerottet (2011). PPR (Pest der kleinen Wiederkäuer) noch endemisch in Teilen Afrikas und Asiens.",
    transmission:
      "Direktkontakt, Aerosole.",
    symptoms:
      "Fieber, Erosionen an Schleimhäuten, Durchfall, hohe Sterblichkeit.",
    prevention:
      "Einfuhrkontrolle, Impfung in Endemiegebieten.",
    affected_species: ["milchvieh"],
  },
  {
    topic_key: "PferdeKrankheit",
    name: "Pferdekrankheiten (Rhinopneumonie / Influenza)",
    description:
      "Verschiedene Atemwegserkrankungen bei Pferden, teilweise meldepflichtig.",
    transmission:
      "Aerosole, Direktkontakt.",
    symptoms:
      "Atemwegssymptome, Fieber, Aborte (Rhinopneumonie).",
    prevention:
      "Impfung, Quarantäne zugekaufter Tiere.",
    affected_species: ["allgemein"],
  },
  {
    topic_key: "allgemein",
    name: "Allgemeine Tiergesundheitsmeldung",
    description:
      "Keiner spezifischen Krankheit zugeordnete amtliche Meldung.",
    transmission: "",
    symptoms: "",
    prevention: "",
    affected_species: ["allgemein"],
  },
];

export async function runDiseaseCatalogMigration(): Promise<void> {
  try {
    // 1. disease_catalog Tabelle erstellen (idempotent)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS disease_catalog (
        id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        topic_key   text NOT NULL UNIQUE,
        name        text NOT NULL,
        description text NOT NULL DEFAULT '',
        transmission text NOT NULL DEFAULT '',
        symptoms    text NOT NULL DEFAULT '',
        prevention  text NOT NULL DEFAULT '',
        affected_species text[] NOT NULL DEFAULT '{allgemein}',
        created_at  timestamptz NOT NULL DEFAULT now(),
        updated_at  timestamptz NOT NULL DEFAULT now()
      )
    `);

    // 2. affected_species Spalte zu animal_health_alerts hinzufügen (idempotent)
    await pool.query(`
      ALTER TABLE animal_health_alerts
      ADD COLUMN IF NOT EXISTS affected_species text[] NOT NULL DEFAULT '{allgemein}'
    `);

    // 3. Seed — INSERT ON CONFLICT DO NOTHING (idempotent)
    for (const row of CATALOG_SEED) {
      await pool.query(
        `
        INSERT INTO disease_catalog
          (topic_key, name, description, transmission, symptoms, prevention, affected_species)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (topic_key) DO UPDATE SET
          name         = EXCLUDED.name,
          description  = EXCLUDED.description,
          transmission = EXCLUDED.transmission,
          symptoms     = EXCLUDED.symptoms,
          prevention   = EXCLUDED.prevention,
          affected_species = EXCLUDED.affected_species,
          updated_at   = now()
        `,
        [
          row.topic_key,
          row.name,
          row.description,
          row.transmission,
          row.symptoms,
          row.prevention,
          row.affected_species,
        ],
      );
    }

    // 4. Bereits vorhandene animal_health_alerts mit affectedSpecies befüllen,
    //    basierend auf dem topic-Feld (für historische Datensätze)
    await pool.query(`
      UPDATE animal_health_alerts a
      SET affected_species = dc.affected_species
      FROM disease_catalog dc
      WHERE dc.topic_key = a.topic
        AND a.affected_species = '{allgemein}'
        AND dc.topic_key <> 'allgemein'
    `);

    logger.info("Disease-Catalog-Migration abgeschlossen (Tabelle + Spalte + Seed + Backfill)");
  } catch (err) {
    logger.warn({ err }, "Disease-Catalog-Migration fehlgeschlagen — Server startet trotzdem");
  }
}
