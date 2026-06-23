import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

// Stripe client — only instantiated when the secret key is available.
// All billing endpoints check this and return 503 if Stripe is not configured.
export function getStripeClient(): Stripe {
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY ist nicht konfiguriert");
  }
  return new Stripe(secretKey);
}

export function isStripeConfigured(): boolean {
  return !!secretKey;
}

export const STARTER_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID ?? "";
export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export function planFromPriceId(priceId: string | null | undefined): string {
  if (!priceId) return "free";
  if (priceId === STARTER_PRICE_ID) return "starter";
  if (priceId === PRO_PRICE_ID) return "pro";
  return "free";
}
