import { Resend } from "resend";
import { createHmac } from "crypto";
import { logger } from "./logger";

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
    '<p style="margin:0;color:#ffffff;font-size:22px;font-weight:bold;">&#127807; Milchvieh Assistent</p>' +
    "</td></tr>" +
    '<tr><td style="padding:32px;">' + body + "</td></tr>" +
    '<tr><td style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #e0e0e0;">' +
    '<p style="margin:0 0 4px;color:#999;font-size:12px;">Milchvieh Datenanalyse-Assistent</p>' +
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
