/**
 * In-memory sliding-window rate limiter per userId.
 *
 * Two independent windows are enforced:
 *   • SHORT: max 8 requests per 60 seconds
 *   • LONG:  max 30 requests per 3600 seconds
 *
 * Both limits are configurable via environment variables:
 *   RATE_LIMIT_SHORT_MAX   (default 8)
 *   RATE_LIMIT_SHORT_SEC   (default 60)
 *   RATE_LIMIT_LONG_MAX    (default 30)
 *   RATE_LIMIT_LONG_SEC    (default 3600)
 *
 * Operators are exempt from both limits.
 *
 * The store is kept in process memory — no DB round-trip, intentionally.
 * Memory footprint: each entry holds two arrays of timestamps, capped at
 * max(SHORT_MAX, LONG_MAX) entries per user. Entries are lazily evicted
 * whenever the user makes a new request (no background timer needed).
 */

import { logger } from "./logger";

const SHORT_MAX = parseInt(process.env.RATE_LIMIT_SHORT_MAX ?? "8", 10);
const SHORT_SEC = parseInt(process.env.RATE_LIMIT_SHORT_SEC ?? "60", 10);
const LONG_MAX = parseInt(process.env.RATE_LIMIT_LONG_MAX ?? "30", 10);
const LONG_SEC = parseInt(process.env.RATE_LIMIT_LONG_SEC ?? "3600", 10);

interface WindowState {
  short: number[];
  long: number[];
}

const store = new Map<string, WindowState>();

function getState(userId: string): WindowState {
  let state = store.get(userId);
  if (!state) {
    state = { short: [], long: [] };
    store.set(userId, state);
  }
  return state;
}

function evict(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter((t) => t > cutoff);
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds?: number;
  reason?: string;
}

/**
 * Check whether `userId` is within rate limits.
 * If `isOperator` is true the check always passes.
 *
 * Side-effect: records the current timestamp only when `allowed === true`.
 */
export function checkRateLimit(userId: string, isOperator: boolean): RateLimitResult {
  if (isOperator) {
    return { allowed: true };
  }

  const now = Date.now();
  const state = getState(userId);

  state.short = evict(state.short, SHORT_SEC * 1000, now);
  state.long = evict(state.long, LONG_SEC * 1000, now);

  if (state.short.length >= SHORT_MAX) {
    const oldest = state.short[0];
    const retryAfterMs = oldest + SHORT_SEC * 1000 - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    logger.warn({ userId, window: "short", count: state.short.length }, "Rate limit exceeded (short window)");
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Zu viele Anfragen. Bitte warte ${retryAfterSeconds} Sekunde${retryAfterSeconds !== 1 ? "n" : ""} und versuche es erneut.`,
    };
  }

  if (state.long.length >= LONG_MAX) {
    const oldest = state.long[0];
    const retryAfterMs = oldest + LONG_SEC * 1000 - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);
    logger.warn({ userId, window: "long", count: state.long.length }, "Rate limit exceeded (long window)");
    return {
      allowed: false,
      retryAfterSeconds,
      reason: `Stundenlimit erreicht (${LONG_MAX} Anfragen pro Stunde). Bitte warte ${Math.ceil(retryAfterSeconds / 60)} Minute${Math.ceil(retryAfterSeconds / 60) !== 1 ? "n" : ""}.`,
    };
  }

  state.short.push(now);
  state.long.push(now);

  return { allowed: true };
}
