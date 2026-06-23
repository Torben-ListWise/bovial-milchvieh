import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../lib/auth";
import { z } from "zod";
import Stripe from "stripe";

const router: IRouter = Router();

// Instantiate Stripe once at module load — not on every request.
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
const stripe = stripeSecretKey
  ? new Stripe(stripeSecretKey, { apiVersion: "2025-05-28.basil" })
  : null;

const STRIPE_PLANS: Record<string, { priceId: string; name: string }> = {
  starter: {
    priceId: process.env.STRIPE_PRICE_STARTER ?? "",
    name: "Professional",
  },
  pro: {
    priceId: process.env.STRIPE_PRICE_PRO ?? "",
    name: "Premium",
  },
};

const CreateCheckoutSessionBody = z.object({
  planKey: z.enum(["starter", "pro"]),
  successUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

router.post(
  "/api/checkout/create-session",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    if (!stripe) {
      res.status(503).json({
        error: "Stripe ist derzeit nicht konfiguriert. Bitte kontaktiere den Support.",
      });
      return;
    }

    const parsed = CreateCheckoutSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Ungültige Anfrage", details: parsed.error.flatten() });
      return;
    }

    const { planKey, successUrl, cancelUrl } = parsed.data;
    const plan = STRIPE_PLANS[planKey];

    if (!plan.priceId) {
      res.status(503).json({
        error: `Stripe-Preis für Plan "${plan.name}" ist nicht konfiguriert.`,
      });
      return;
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: req.appUser?.email ?? undefined,
        line_items: [{ price: plan.priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
          userId: req.appUser?.id ?? "",
          planKey,
        },
        locale: "de",
      });

      res.json({ url: session.url });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unbekannter Fehler";
      res.status(500).json({ error: `Stripe-Fehler: ${message}` });
    }
  },
);

export default router;
