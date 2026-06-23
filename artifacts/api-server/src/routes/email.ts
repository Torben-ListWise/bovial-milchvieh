import { Router, type IRouter, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { unsubscribeToken } from "../lib/emailService";

const router: IRouter = Router();

/**
 * GET /api/email/unsubscribe?token=<hmac>&uid=<userId>
 * Stateless unsubscribe — validates HMAC token, sets digestOptOut = true.
 * Required by EU law (DSGVO / TDDDG) for all bulk/digest e-mails.
 */
router.get("/email/unsubscribe", async (req: Request, res: Response) => {
  const { token, uid } = req.query as { token?: string; uid?: string };

  if (!token || !uid) {
    res.status(400).send("Ungültiger Abmelde-Link.");
    return;
  }

  const expected = unsubscribeToken(uid);
  if (token !== expected) {
    res.status(400).send("Ungültiger oder abgelaufener Abmelde-Link.");
    return;
  }

  try {
    const [user] = await db
      .select({ id: usersTable.id, digestOptOut: usersTable.digestOptOut })
      .from(usersTable)
      .where(eq(usersTable.id, uid))
      .limit(1);

    if (!user) {
      res.status(404).send("Nutzer nicht gefunden.");
      return;
    }

    if (!user.digestOptOut) {
      await db
        .update(usersTable)
        .set({ digestOptOut: true })
        .where(eq(usersTable.id, uid));
      logger.info({ userId: uid }, "Nutzer hat Digest abgemeldet");
    }

    res.send(`<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Abgemeldet</title>
  <style>
    body { font-family: Arial, sans-serif; background: #f4f4f4; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .card { background: #fff; border-radius: 8px; padding: 40px; max-width: 480px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    h1 { color: #2e7d32; margin-bottom: 12px; font-size: 24px; }
    p { color: #555; line-height: 1.6; }
    a { color: #2e7d32; }
  </style>
</head>
<body>
  <div class="card">
    <h1>✅ Erfolgreich abgemeldet</h1>
    <p>Du erhältst keine monatlichen Zusammenfassungen mehr vom Milchvieh Assistenten.</p>
    <p>Andere E-Mails (z.&nbsp;B. Konto-Benachrichtigungen) sind davon nicht betroffen.</p>
    <p><a href="/">Zurück zur App</a></p>
  </div>
</body>
</html>`);
  } catch (err) {
    logger.error({ err, userId: uid }, "Unsubscribe fehlgeschlagen");
    res.status(500).send("Es ist ein Fehler aufgetreten. Bitte später erneut versuchen.");
  }
});

export default router;
