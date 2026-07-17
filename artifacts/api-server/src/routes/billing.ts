import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db, subscriptionsTable, stripeEventsTable, usersTable } from "@workspace/db";
import { requireAuth } from "../lib/auth";
import { logger } from "../lib/logger";
import { getStripeClient, isStripeConfigured, planFromPriceId, BASIS_PRICE_ID, STARTER_PRICE_ID, PRO_PRICE_ID, PREMIUM_MAX_PRICE_ID, WEBHOOK_SECRET } from "../lib/stripe";
import { getQuotaStatus, PLAN_LIMITS } from "../lib/quota";
import { sendPlanActivated, sendPaymentFailed, fireEmail } from "../lib/emailService";
import type Stripe from "stripe";

const router: IRouter = Router();

function notConfigured(res: Response) {
  res.status(503).json({ error: "Stripe ist nicht konfiguriert" });
}

// GET /api/billing/status — current plan, quota, period info
router.get("/billing/status", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured()) { notConfigured(res); return; }

  try {
    const userId = req.userId!;
    const { plan, limit, used, periodEnd, gracePeriodEndsAt } = await getQuotaStatus(userId);

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(sql`${subscriptionsTable.userId} = ${userId}`)
      .limit(1);

    res.json({
      plan,
      creditsUsed: used,
      creditsLimit: limit === Infinity ? null : limit,
      // Legacy aliases — kept for backwards compat during rollout
      analysesUsed: used,
      analysesLimit: limit === Infinity ? null : limit,
      periodEnd: periodEnd ?? null,
      gracePeriodEndsAt: gracePeriodEndsAt ?? null,
      stripeCustomerId: sub?.stripeCustomerId ?? null,
    });
  } catch (err) {
    logger.error({ err }, "billing/status failed");
    res.status(500).json({ error: "Fehler beim Laden des Abo-Status" });
  }
});

// POST /api/billing/checkout — create Stripe Checkout session
router.post("/billing/checkout", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured()) { notConfigured(res); return; }

  const { plan, successUrl, cancelUrl } = req.body as {
    plan?: string;
    successUrl?: string;
    cancelUrl?: string;
  };

  const priceIdMap: Record<string, string> = {
    basis: BASIS_PRICE_ID,
    starter: STARTER_PRICE_ID,
    pro: PRO_PRICE_ID,
    premium_max: PREMIUM_MAX_PRICE_ID,
  };
  const priceId = plan ? priceIdMap[plan] : undefined;

  if (!priceId) {
    res.status(400).json({ error: "Ungültiger Plan. Erlaubt: basis, starter, pro, premium_max" });
    return;
  }

  try {
    const stripe = getStripeClient();
    const userId = req.userId!;
    const user = req.appUser!;

    let [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(sql`${subscriptionsTable.userId} = ${userId}`)
      .limit(1);

    let customerId = sub?.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        name: user.name ?? undefined,
        metadata: { userId },
      });
      customerId = customer.id;
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:3000";

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      automatic_tax: { enabled: true },
      customer_update: { address: "auto" },
      success_url: successUrl ?? `${baseUrl}/app/settings?billing=success`,
      cancel_url: cancelUrl ?? `${baseUrl}/app/settings?billing=cancel`,
      metadata: { userId },
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "billing/checkout failed");
    res.status(500).json({ error: "Checkout konnte nicht erstellt werden" });
  }
});

// POST /api/billing/portal — redirect to Stripe Customer Portal
router.post("/billing/portal", requireAuth, async (req: Request, res: Response) => {
  if (!isStripeConfigured()) { notConfigured(res); return; }

  try {
    const stripe = getStripeClient();
    const userId = req.userId!;

    const [sub] = await db
      .select()
      .from(subscriptionsTable)
      .where(sql`${subscriptionsTable.userId} = ${userId}`)
      .limit(1);

    if (!sub?.stripeCustomerId) {
      res.status(400).json({ error: "Kein Stripe-Konto gefunden" });
      return;
    }

    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "http://localhost:3000";

    const { returnUrl } = req.body as { returnUrl?: string };

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: returnUrl ?? `${baseUrl}/app/settings`,
    });

    res.json({ url: portalSession.url });
  } catch (err) {
    logger.error({ err }, "billing/portal failed");
    res.status(500).json({ error: "Portal konnte nicht geöffnet werden" });
  }
});

// POST /api/billing/webhook — Stripe webhook handler (raw body, idempotent)
router.post("/billing/webhook", async (req: Request, res: Response) => {
  if (!isStripeConfigured()) { notConfigured(res); return; }
  if (!WEBHOOK_SECRET) {
    res.status(503).json({ error: "Webhook-Secret nicht konfiguriert" });
    return;
  }

  const sig = req.headers["stripe-signature"] as string;
  let event: Stripe.Event;

  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, sig, WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err }, "Webhook-Signaturprüfung fehlgeschlagen");
    res.status(400).json({ error: "Ungültige Webhook-Signatur" });
    return;
  }

  const insertResult = await db.execute(
    sql`INSERT INTO stripe_events (event_id) VALUES (${event.id}) ON CONFLICT (event_id) DO NOTHING`,
  ).catch(() => null);

  const rowCount = (insertResult as any)?.rowCount ?? (insertResult as any)?.count ?? 1;
  if (rowCount === 0) {
    logger.debug({ eventId: event.id, type: event.type }, "Webhook-Duplikat — übersprungen");
    res.json({ received: true, duplicate: true });
    return;
  }

  try {
    await handleWebhookEvent(event);
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, "Webhook-Verarbeitung fehlgeschlagen");
    res.status(500).json({ error: "Webhook-Verarbeitung fehlgeschlagen" });
    return;
  }

  res.json({ received: true });
});

async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") break;

      const userId = session.metadata?.userId;
      if (!userId) break;

      const stripe = getStripeClient();
      const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
      const priceId = subscription.items.data[0]?.price.id ?? null;
      const plan = planFromPriceId(priceId);

      await upsertSubscription(userId, {
        stripeCustomerId: session.customer as string,
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        plan,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        gracePeriodEndsAt: null,
      });
      logger.info({ userId, plan }, "Checkout abgeschlossen — Plan aktiviert");

      const [userRow] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(sql`${usersTable.id} = ${userId}`)
        .limit(1);
      if (userRow?.email) {
        const newLimit = PLAN_LIMITS[plan] ?? null;
        fireEmail(
          sendPlanActivated(userRow.email, userRow.name, plan, newLimit === Infinity ? null : (newLimit ?? null)),
          `plan-activated:${userId}`,
        );
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await userIdFromCustomer(subscription.customer as string);
      if (!userId) break;

      const priceId = subscription.items.data[0]?.price.id ?? null;
      const plan = planFromPriceId(priceId);

      await upsertSubscription(userId, {
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        plan,
        status: subscription.status,
        currentPeriodEnd: new Date(subscription.current_period_end * 1000),
        gracePeriodEndsAt: null,
      });
      logger.info({ userId, plan, status: subscription.status }, "Abo aktualisiert");
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = await userIdFromCustomer(subscription.customer as string);
      if (!userId) break;

      await upsertSubscription(userId, {
        plan: "basis",
        status: "canceled",
        stripeSubscriptionId: null,
        stripePriceId: null,
        currentPeriodEnd: null,
        gracePeriodEndsAt: null,
      });
      logger.info({ userId }, "Abo gekündigt — auf Basis downgegradet");
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const userId = await userIdFromCustomer(invoice.customer as string);
      if (!userId) break;

      const gracePeriodEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      await db.execute(sql`
        UPDATE subscriptions
        SET grace_period_ends_at = ${gracePeriodEndsAt}, updated_at = NOW()
        WHERE user_id = ${userId}
      `);
      logger.info({ userId, gracePeriodEndsAt }, "Zahlung fehlgeschlagen — Grace Period gestartet");

      const [userRowFailed] = await db
        .select({ email: usersTable.email, name: usersTable.name })
        .from(usersTable)
        .where(sql`${usersTable.id} = ${userId}`)
        .limit(1);
      if (userRowFailed?.email) {
        fireEmail(
          sendPaymentFailed(userRowFailed.email, userRowFailed.name, userId, gracePeriodEndsAt),
          `payment-failed:${userId}`,
        );
      }
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      const userId = await userIdFromCustomer(invoice.customer as string);
      if (!userId) break;

      await db.execute(sql`
        UPDATE subscriptions
        SET grace_period_ends_at = NULL, status = 'active', updated_at = NOW()
        WHERE user_id = ${userId}
      `);
      logger.info({ userId }, "Zahlung erfolgreich — Grace Period zurückgesetzt");
      break;
    }

    default:
      logger.debug({ type: event.type }, "Unbekannter Webhook-Event-Typ");
  }
}

async function upsertSubscription(
  userId: string,
  data: Partial<{
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    stripePriceId: string | null;
    plan: string;
    status: string;
    currentPeriodEnd: Date | null;
    gracePeriodEndsAt: Date | null;
  }>,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO subscriptions (
      user_id, stripe_customer_id, stripe_subscription_id, stripe_price_id,
      plan, status, current_period_end, grace_period_ends_at, updated_at
    ) VALUES (
      ${userId},
      ${data.stripeCustomerId ?? null},
      ${data.stripeSubscriptionId ?? null},
      ${data.stripePriceId ?? null},
      ${data.plan ?? "basis"},
      ${data.status ?? "active"},
      ${data.currentPeriodEnd ?? null},
      ${data.gracePeriodEndsAt ?? null},
      NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      stripe_customer_id = COALESCE(${data.stripeCustomerId ?? null}, subscriptions.stripe_customer_id),
      stripe_subscription_id = COALESCE(${data.stripeSubscriptionId ?? null}, subscriptions.stripe_subscription_id),
      stripe_price_id = ${data.stripePriceId ?? null},
      plan = ${data.plan ?? "basis"},
      status = ${data.status ?? "active"},
      current_period_end = ${data.currentPeriodEnd ?? null},
      grace_period_ends_at = ${data.gracePeriodEndsAt ?? null},
      updated_at = NOW()
  `);
}

async function userIdFromCustomer(customerId: string): Promise<string | null> {
  const [sub] = await db
    .select({ userId: subscriptionsTable.userId })
    .from(subscriptionsTable)
    .where(sql`${subscriptionsTable.stripeCustomerId} = ${customerId}`)
    .limit(1);

  if (sub) return sub.userId;

  try {
    const stripe = getStripeClient();
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return null;
    return (customer as Stripe.Customer).metadata?.userId ?? null;
  } catch {
    return null;
  }
}

// GET /api/quota/status — lightweight plan+quota status, no Stripe dependency
router.get("/quota/status", requireAuth, async (req: Request, res: Response) => {
  try {
    const { plan, limit, used } = await getQuotaStatus(req.userId!);
    res.json({
      plan,
      creditsUsed: used,
      creditsLimit: limit === Infinity ? null : limit,
      // Legacy aliases
      analysesUsed: used,
      analysesLimit: limit === Infinity ? null : limit,
    });
  } catch (err) {
    logger.error({ err }, "quota/status failed");
    res.status(500).json({ error: "Fehler beim Laden des Kontingent-Status" });
  }
});

export default router;
