import { Resend } from "resend";
import { createHmac } from "crypto";
import { logger } from "./logger";
import { getNewsletterTheme } from "@workspace/db";
import type { NewsletterEdition } from "@workspace/db";

const RESEND_API_KEY = process.env.RESEND_API_KEY ?? "";
const EMAIL_FROM = process.env.EMAIL_FROM ?? "noreply@milchvieh.de";

function getAppUrl(): string {
  if (process.env.APP_URL) return process.env.APP_URL;
  if (process.env.REPLIT_DEV_DOMAIN) return "https://" + process.env.REPLIT_DEV_DOMAIN;
  return "https://milchvieh.de";
}

function getResend(): Resend | null {
  if (!RESEND_API_KEY) return null;
  return new Resend(RESEND_API_KEY);
}

function unsubscribeToken(userId: string): string {
  const secret = RESEND_API_KEY || "milchvieh-digest-secret";
  return createHmac("sha256", secret).update(userId).digest("hex");
}

function unsubscribeUrl(userId: string): string {
  const base = getAppUrl();
  const token = unsubscribeToken(userId);
  return base + "/api/email/unsubscribe?token=" + token + "&uid=" + encodeURIComponent(userId);
}

const BRAND_GREEN = "#2e7d32";
const BRAND_GREEN_LIGHT = "#e8f5e9";

function baseHtml(title: string, body: string, userId?: string): string {
  const footerExtra = userId
    ? '<p style="margin:0 0 4px;font-size:12px;color:#888;">Keine monatlichen Zusammenfassungen mehr? <a href="' + unsubscribeUrl(userId) + '" style="color:#666;">Abmelden</a></p>'
    : "";

  return (
    '<!DOCTYPE html><html lang="de"><head>' +
    '<meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
    "<title>" + title + "</title>" +
    "</head>" +
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">' +
    "<tr><td align=\"center\">" +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">' +
    "<tr>" +
    '<td style="background:' + BRAND_GREEN + ';padding:24px 32px;">' +
    '<p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">&#127807; Bovial</p>' +
    "</td></tr>" +
    '<tr><td style="padding:32px;">' + body + "</td></tr>" +
    '<tr><td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #e0e0e0;">' +
    '<p style="margin:0 0 4px;color:#999;font-size:12px;">Bovial — KI-gestützte Betriebsanalyse</p>' +
    footerExtra +
    '<p style="margin:0;color:#bbb;font-size:11px;">Diese E-Mail wurde automatisch generiert. Bitte nicht direkt antworten.</p>' +
    "</td></tr>" +
    "</table></td></tr></table>" +
    "</body></html>"
  );
}

function ctaButton(label: string, url: string): string {
  return (
    '<a href="' + url + '" style="display:inline-block;background:' + BRAND_GREEN +
    ';color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:15px;font-weight:bold;margin-top:16px;">' +
    label + "</a>"
  );
}

function h1(text: string): string {
  return '<h1 style="margin:0 0 16px;font-size:24px;color:#1a1a1a;">' + text + "</h1>";
}

function p(text: string): string {
  return '<p style="margin:0 0 12px;font-size:15px;color:#333;line-height:1.6;">' + text + "</p>";
}

function infoBox(html: string, warn = false): string {
  const bg = warn ? "#fff3e0" : BRAND_GREEN_LIGHT;
  const border = warn ? "border:1px solid #ffb74d;" : "";
  const color = warn ? "#e65100" : "#1a1a1a";
  return (
    '<table style="background:' + bg + ";" + border + 'border-radius:6px;padding:16px;margin:16px 0;width:100%;box-sizing:border-box;">' +
    "<tr><td style=\"font-size:14px;color:" + color + ";\">" + html + "</td></tr></table>"
  );
}

export async function sendWelcome(to: string, name: string | null): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const greeting = name ? "Hallo " + name + "," : "Herzlich willkommen,";
  const appUrl = getAppUrl();

  const body =
    h1("Willkommen beim Milchvieh Assistenten! &#128004;") +
    p(greeting) +
    p("Sch&#246;n, dass du dabei bist! Mit dem Milchvieh Assistenten kannst du deine Betriebsdaten hochladen und sofort mit KI-gest&#252;tzten Analysen starten &mdash; ganz ohne Vorkenntnisse.") +
    p("<strong>So geht&#8217;s los:</strong><br>1. Lade deine Betriebsdaten hoch (Excel, CSV)<br>2. Stelle deine erste Frage &mdash; oder nutze eine Vorlage<br>3. Erhalte sofortige Analysen und Handlungsempfehlungen") +
    ctaButton("Jetzt starten", appUrl + "/app");

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Willkommen beim Milchvieh Assistenten",
    html: baseHtml("Willkommen", body),
  });
}

export async function sendPlanActivated(
  to: string,
  name: string | null,
  planName: string,
  newLimit: number | null,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const greeting = name ? "Hallo " + name + "," : "Guten Tag,";
  const planLabel = planName === "pro" ? "Pro" : planName === "starter" ? "Starter" : planName;
  const limitText = newLimit != null ? newLimit + " Analysen pro Monat" : "unbegrenzte Analysen";
  const appUrl = getAppUrl();

  const body =
    h1("Dein " + planLabel + "-Plan ist jetzt aktiv &#10003;") +
    p(greeting) +
    p("Dein Upgrade auf den <strong>" + planLabel + "-Plan</strong> war erfolgreich. Du hast ab sofort Zugriff auf <strong>" + limitText + "</strong>.") +
    infoBox(
      "<strong>Dein neuer Plan:</strong> " + planLabel + "<br>" +
      "<strong>Analysen pro Monat:</strong> " + limitText + "<br>" +
      "<strong>Rechnung:</strong> Wird separat von Stripe per E-Mail zugestellt"
    ) +
    p("Viel Erfolg bei deinen Analysen!") +
    ctaButton("Zur App", appUrl + "/app");

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Dein " + planLabel + "-Plan ist aktiv",
    html: baseHtml("Plan aktiviert", body),
  });
}

export async function sendQuotaWarning(
  to: string,
  name: string | null,
  userId: string,
  used: number,
  limit: number,
  plan: string,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const greeting = name ? "Hallo " + name + "," : "Guten Tag,";
  const remaining = limit - used;
  const appUrl = getAppUrl();

  const body =
    h1("Du hast 80&nbsp;% deines Kontingents verbraucht") +
    p(greeting) +
    p("Du hast in diesem Monat bereits <strong>" + used + " von " + limit + " Analysen</strong> genutzt. Es verbleiben noch <strong>" + remaining + " Analysen</strong>.") +
    p("Damit du ohne Unterbrechung weiterarbeiten kannst, empfehlen wir ein Upgrade auf den n&#228;chsh&#246;heren Tarif.") +
    ctaButton("Jetzt upgraden", appUrl + "/app/settings?tab=billing") +
    p('<span style="font-size:13px;color:#888;">Aktueller Plan: ' + plan + '. Nach dem Upgrade stehen dir sofort mehr Analysen zur Verf&#252;gung.</span>');

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "80 % deines Analysekontingents verbraucht",
    html: baseHtml("Kontingent-Warnung", body, userId),
  });
}

export async function sendPaymentFailed(
  to: string,
  name: string | null,
  userId: string,
  gracePeriodEndsAt: Date,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const greeting = name ? "Hallo " + name + "," : "Guten Tag,";
  const deadline = gracePeriodEndsAt.toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const appUrl = getAppUrl();

  const body =
    h1("Zahlungsproblem bei deinem Abonnement") +
    p(greeting) +
    p("Leider konnte deine letzte Zahlung nicht verarbeitet werden. Dein Zugang bleibt bis zum <strong>" + deadline + "</strong> (7&nbsp;Tage) erhalten &mdash; bitte aktualisiere deine Zahlungsmethode bis dahin, um eine Unterbrechung zu vermeiden.") +
    infoBox(
      "<strong>Frist:</strong> " + deadline + "<br>" +
      "Nach diesem Datum wird dein Konto auf den kostenlosen Plan zur&#252;ckgesetzt.",
      true,
    ) +
    p("Im Stripe-Kundenportal kannst du deine Zahlungsmethode schnell und sicher aktualisieren:") +
    ctaButton("Zahlungsmethode aktualisieren", appUrl + "/app/settings?tab=billing");

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Zahlungsproblem \u2014 Bitte Zahlungsmethode aktualisieren",
    html: baseHtml("Zahlungsfehler", body, userId),
  });
}

export async function sendMonthlyDigest(
  to: string,
  name: string | null,
  userId: string,
  stats: {
    analysesThisMonth: number;
    topCategory: string | null;
    month: string;
  },
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const greeting = name ? "Hallo " + name + "," : "Guten Tag,";
  const appUrl = getAppUrl();
  const categoryLine = stats.topCategory
    ? "<br><strong>H&#228;ufigster Analysebereich:</strong> " + stats.topCategory
    : "";

  const activityNote = stats.analysesThisMonth === 0
    ? p("Im letzten Monat wurden keine Analysen durchgef&#252;hrt. Starte jetzt und entdecke wertvolle Einblicke f&#252;r deinen Betrieb!")
    : p("Gute Arbeit! Regelm&#228;&#223;ige Analysen helfen dir, Trends fr&#252;hzeitig zu erkennen und deinen Betrieb gezielt zu optimieren.");

  const body =
    h1("Deine Monats-Zusammenfassung &ndash; " + stats.month) +
    p(greeting) +
    p("Hier ist ein kurzer &#220;berblick &#252;ber deine Aktivit&#228;ten im vergangenen Monat:") +
    infoBox(
      "<strong>Analysen durchgef&#252;hrt:</strong> " + stats.analysesThisMonth + categoryLine
    ) +
    activityNote +
    p('<strong>Tipp des Monats:</strong> Nutze die Vorlage &#8222;Herdenstruktur &amp; Remontierung&#8220;, um deine Laktationsnummern-Verteilung im Blick zu behalten.') +
    ctaButton("Zur App", appUrl + "/app");

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Deine Zusammenfassung f\u00fcr " + stats.month,
    html: baseHtml("Monats-Digest", body, userId),
  });
}

export async function sendTrialEnding(
  to: string,
  name: string | null,
  userId: string,
  trialEnd: Date,
  portalUrl: string,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const greeting = name ? "Hallo " + name + "," : "Guten Tag,";
  const endDate = trialEnd.toLocaleDateString("de-DE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const appUrl = getAppUrl();

  const body =
    h1("Dein Testzugang endet in 3 Tagen") +
    p(greeting) +
    p("Dein kostenloser 14-Tage-Testzeitraum l&#228;uft am <strong>" + endDate + "</strong> ab. Danach wird dein Professional-Abo automatisch zu <strong>19&nbsp;&#8364;/Monat (inkl. 19&nbsp;% MwSt.)</strong> verl&#228;ngert.") +
    infoBox(
      "<strong>Testende:</strong> " + endDate + "<br>" +
      "<strong>Danach:</strong> 19&nbsp;&#8364;/Monat inkl. MwSt. (Professional-Plan)<br>" +
      "<strong>Kreditkarte:</strong> wird erst nach Ablauf belastet"
    ) +
    p("M&#246;chtest du nicht verl&#228;ngern? Jetzt noch rechtzeitig k&#252;ndigen &mdash; schnell und ohne Formulare:") +
    ctaButton("Abo jetzt k&#252;ndigen", portalUrl) +
    p("Wenn du das Abo beh&#228;ltst, passiert nichts weiter. Dein Professional-Zugang bleibt ohne Unterbrechung aktiv.") +
    ctaButton("Zur App", appUrl + "/app");

  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: "Dein Bovial-Testzeitraum endet in 3 Tagen",
    html: baseHtml("Testende-Erinnerung", body, userId),
  });
}

/**
 * Build a table-based HTML email for a newsletter edition.
 * Uses inline styles only — no <style> blocks (Resend/Gmail safe).
 */
export function newsletterEditionHtml(edition: NewsletterEdition, userId?: string): string {
  const theme = getNewsletterTheme(edition.topic);
  const appUrl = getAppUrl();

  const kpiTiles = (edition.kpiTiles ?? []) as { value: string; label: string; sourceIndex: number }[];
  const causeEffect = (edition.causeEffect ?? []) as string[];
  const checklist = (edition.checklist ?? []) as string[];
  const sources = (edition.sources ?? []) as { name: string; url: string }[];

  const formattedDate = new Date(edition.scheduledDate).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  // ── KPI tiles (2-column table) ──────────────────────────────────────────────
  let kpiSection = "";
  if (kpiTiles.length > 0) {
    function kpiCellHtml(tile: { value: string; label: string; sourceIndex: number }): string {
      return (
        '<td width="50%" style="padding:8px;">' +
        '<table width="100%" cellpadding="0" cellspacing="0" style="background:' + theme.bg + ';border:1px solid ' + theme.color + '33;border-radius:6px;padding:14px;">' +
        '<tr><td style="font-size:26px;font-weight:900;color:' + theme.color + ';line-height:1.1;">' + tile.value + '</td></tr>' +
        '<tr><td style="font-size:12px;color:#555;padding-top:4px;">' + tile.label + '</td></tr>' +
        '<tr><td style="font-size:11px;color:#999;padding-top:6px;">[' + (tile.sourceIndex + 1) + ']</td></tr>' +
        '</table></td>'
      );
    }
    const emptyCell = '<td width="50%" style="padding:8px;"></td>';
    const rows: string[] = [];
    for (let i = 0; i < kpiTiles.length; i += 2) {
      const left = kpiCellHtml(kpiTiles[i]);
      const right = i + 1 < kpiTiles.length ? kpiCellHtml(kpiTiles[i + 1]) : emptyCell;
      rows.push("<tr>" + left + right + "</tr>");
    }

    kpiSection =
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">' +
      rows.join("") +
      "</table>";
  }

  // ── Cause → Effect chain ────────────────────────────────────────────────────
  let causeEffectSection = "";
  if (causeEffect.length === 3) {
    const cells = causeEffect
      .map((step, i) => {
        const cell =
          '<td style="padding:10px 12px;font-size:13px;font-weight:600;color:' + theme.color + ';background:' + theme.bg + ';border-radius:4px;text-align:center;">' +
          step + "</td>";
        if (i < causeEffect.length - 1) {
          return cell + '<td style="padding:0 6px;font-size:18px;color:#aaa;text-align:center;">&rarr;</td>';
        }
        return cell;
      })
      .join("");
    causeEffectSection =
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">' +
      "<tr>" + cells + "</tr>" +
      "</table>";
  }

  // ── Body paragraphs ─────────────────────────────────────────────────────────
  const bodyHtml = edition.appBody
    .split(/\n\n+/)
    .map((para) =>
      '<p style="margin:0 0 14px;font-size:15px;color:#333;line-height:1.65;">' +
      para.replace(/\n/g, "<br>") +
      "</p>",
    )
    .join("");

  // ── Checklist ───────────────────────────────────────────────────────────────
  let checklistSection = "";
  if (checklist.length > 0) {
    const items = checklist
      .map(
        (item) =>
          '<tr><td style="padding:5px 0;font-size:14px;color:#333;">' +
          '<span style="color:' + theme.color + ';font-weight:bold;margin-right:8px;">&#10003;</span>' +
          item + "</td></tr>",
      )
      .join("");
    checklistSection =
      '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border:1px solid #e0e0e0;border-radius:6px;padding:14px;margin:16px 0;">' +
      '<tr><td style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:' + theme.color + ';padding-bottom:10px;">Handlungsempfehlungen</td></tr>' +
      items +
      "</table>";
  }

  // ── Sources ─────────────────────────────────────────────────────────────────
  let sourcesSection = "";
  if (sources.length > 0) {
    const items = sources
      .map(
        (s, i) =>
          '<tr><td style="padding:3px 0;font-size:12px;color:#555;">' +
          "[" + (i + 1) + "] " +
          '<a href="' + s.url + '" style="color:#1565C0;">' + s.name + "</a>" +
          "</td></tr>",
      )
      .join("");
    sourcesSection =
      '<p style="margin:20px 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#999;">Quellen</p>' +
      '<table width="100%" cellpadding="0" cellspacing="0">' +
      items +
      "</table>";
  }

  // ── CTA button ──────────────────────────────────────────────────────────────
  const ctaLabel = edition.ctaType === "route" ? "Jetzt ansehen" : "Im Chat besprechen";
  let ctaHref = appUrl + "/app/nachrichten?edition=" + edition.id;
  if (edition.ctaType === "route" && edition.ctaTarget) {
    ctaHref = appUrl + edition.ctaTarget;
  }
  const ctaSection = ctaButton(ctaLabel, ctaHref);

  // ── Unsubscribe footer ──────────────────────────────────────────────────────
  const footerExtra = userId
    ? '<p style="margin:0 0 4px;font-size:12px;color:#888;">Newsletter abbestellen? <a href="' + unsubscribeUrl(userId) + '" style="color:#666;">Abmelden</a></p>'
    : "";

  const body =
    // Colored header bar
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">' +
    '<tr><td style="background:' + theme.bg + ';border-bottom:3px solid ' + theme.color + ';padding:16px 0;">' +
    '<p style="margin:0;font-size:22px;">' + theme.emoji + ' <span style="font-weight:700;color:' + theme.color + ';">' + edition.topic + "</span></p>" +
    '<p style="margin:6px 0 0;font-size:12px;color:#888;">' + formattedDate + "</p>" +
    "</td></tr></table>" +
    h1(edition.title) +
    kpiSection +
    causeEffectSection +
    bodyHtml +
    checklistSection +
    sourcesSection +
    ctaSection;

  const fullBody = body;

  const footerHtml =
    '<p style="margin:0 0 4px;color:#999;font-size:12px;">Bovial — KI-gestützte Betriebsanalyse</p>' +
    footerExtra +
    '<p style="margin:0;color:#bbb;font-size:11px;">Diese E-Mail wurde automatisch generiert. Bitte nicht direkt antworten.</p>';

  return (
    '<!DOCTYPE html><html lang="de"><head>' +
    '<meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
    "<title>" + edition.title + "</title>" +
    "</head>" +
    '<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;">' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 0;">' +
    "<tr><td align=\"center\">" +
    '<table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">' +
    "<tr>" +
    '<td style="background:' + BRAND_GREEN + ';padding:24px 32px;">' +
    '<p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">&#127807; Bovial</p>' +
    "</td></tr>" +
    '<tr><td style="padding:32px;">' + fullBody + "</td></tr>" +
    '<tr><td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #e0e0e0;">' +
    footerHtml +
    "</td></tr>" +
    "</table></td></tr></table>" +
    "</body></html>"
  );
}

/**
 * Send a newsletter edition to a subscriber via Resend.
 */
export async function sendNewsletterEdition(
  to: string,
  userId: string,
  edition: NewsletterEdition,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const html = newsletterEditionHtml(edition, userId);
  await resend.emails.send({
    from: EMAIL_FROM,
    to,
    subject: edition.topic + ": " + edition.title,
    html,
  });
}

/**
 * Send an operator alert when a user triggers the frustration pattern
 * (≥ 2 thumbs-down within 7 days).
 */
export async function sendFrustrationAlert(
  operatorEmail: string,
  userId: string,
  thumbsDownCount: number,
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const appUrl = getAppUrl();
  const body =
    h1("&#9888;&#65039; Nutzer-Frustrationssignal erkannt") +
    p(`Ein Nutzer hat innerhalb der letzten 7 Tage <strong>${thumbsDownCount}&times;</strong> Daumen-runter gegeben.`) +
    p(`<strong>User-ID:</strong> ${userId}`) +
    p("Bitte pr&#252;fe die Beta-Transkripte, um die betroffenen Antworten zu identifizieren und die Wissensdatenbank oder Agenten-Instruktionen entsprechend anzupassen.") +
    ctaButton("Beta-Dashboard &#246;ffnen", appUrl + "/app/admin/beta");

  await resend.emails.send({
    from: EMAIL_FROM,
    to: operatorEmail,
    subject: `[Bovial] Frustrationssignal: ${thumbsDownCount}\u00d7 Daumen-runter (${userId.slice(0, 8)}\u2026)`,
    html: baseHtml("Frustrationssignal", body),
  });
}

/**
 * Send a weekly knowledge-gaps report to the operator.
 * Lists the top missed search queries so the knowledge base can be extended.
 */
export async function sendKnowledgeGapsReport(
  operatorEmail: string,
  data: {
    days: number;
    totalMissed: number;
    gaps: Array<{ query: string; count: number; topScore: number | null }>;
  },
): Promise<void> {
  const resend = getResend();
  if (!resend) return;

  const { days, totalMissed, gaps } = data;

  const escHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const tableRows = gaps
    .map(
      (g, i) =>
        `<tr style="background:${i % 2 === 0 ? "#fff" : "#f9f9f9"}">` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${g.count}&times;</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;">${escHtml(g.query)}</td>` +
        `<td style="padding:8px 12px;border-bottom:1px solid #e0e0e0;color:#888;">${g.topScore != null ? Number(g.topScore).toFixed(3) : "&#8212;"}</td>` +
        `</tr>`,
    )
    .join("");

  const table =
    `<table style="width:100%;border-collapse:collapse;font-size:13px;">` +
    `<thead><tr style="background:#f0f0f0;">` +
    `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d0d0d0;">H&#228;ufigkeit</th>` +
    `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d0d0d0;">Suchanfrage</th>` +
    `<th style="padding:8px 12px;text-align:left;border-bottom:2px solid #d0d0d0;">Bester Score</th>` +
    `</tr></thead><tbody>${tableRows}</tbody></table>`;

  const body =
    h1("&#128218; W&#246;chentlicher Wissensm&#252;cken-Bericht") +
    p(`Zeitraum: letzte <strong>${days} Tage</strong>. Gesamte verpasste Suchanfragen: <strong>${totalMissed}</strong>.`) +
    p("Die folgenden Anfragen fanden keinen ausreichenden Treffer in der Wissensdatenbank:") +
    table +
    p("<em>Tipp: Lade relevante Dokumente unter Wissens-Bibliothek hoch, um h&#228;ufige L&#252;cken zu schlie&#223;en.</em>");

  await resend.emails.send({
    from: EMAIL_FROM,
    to: operatorEmail,
    subject: `[Bovial] Wissensm\u00fccken-Bericht \u2014 letzte ${days} Tage (${totalMissed} verpasste Anfragen)`,
    html: baseHtml("Wissensm\u00fccken-Bericht", body),
  });
}

export function isResendConfigured(): boolean {
  return !!RESEND_API_KEY;
}

export { unsubscribeToken };

/**
 * Fire-and-forget wrapper — logs errors but never throws.
 * All email sends should be wrapped in this.
 */
export function fireEmail(promise: Promise<void>, label: string): void {
  promise.catch((err) => logger.error({ err }, "E-Mail-Versand fehlgeschlagen: " + label));
}
