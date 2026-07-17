import Stripe from "stripe";

const secretKey = process.env.STRIPE_SECRET_KEY;

export function getStripeClient(): Stripe {
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY ist nicht konfiguriert");
  }
  return new Stripe(secretKey);
}

export function isStripeConfigured(): boolean {
  return !!secretKey;
}

export const BASIS_PRICE_ID = process.env.STRIPE_BASIS_PRICE_ID ?? "";
export const STARTER_PRICE_ID = process.env.STRIPE_STARTER_PRICE_ID ?? "";
export const PRO_PRICE_ID = process.env.STRIPE_PRO_PRICE_ID ?? "";
export const PREMIUM_MAX_PRICE_ID = process.env.STRIPE_PREMIUM_MAX_PRICE_ID ?? "";
export const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

export function planFromPriceId(priceId: string | null | undefined): string {
  if (!priceId) return "free";
  if (BASIS_PRICE_ID && priceId === BASIS_PRICE_ID) return "basis";
  if (STARTER_PRICE_ID && priceId === STARTER_PRICE_ID) return "starter";
  if (PRO_PRICE_ID && priceId === PRO_PRICE_ID) return "pro";
  if (PREMIUM_MAX_PRICE_ID && priceId === PREMIUM_MAX_PRICE_ID) return "premium_max";
  return "free";
}
