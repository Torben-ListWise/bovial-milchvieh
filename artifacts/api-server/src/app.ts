import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Redirect www.bovial.com → bovial.com (301 permanent).
// Must run before everything else so www requests never touch auth or CORS.
app.use((req, res, next) => {
  const host = req.headers.host ?? "";
  if (host.startsWith("www.")) {
    const apex = host.slice(4);
    const redirectUrl = `https://${apex}${req.originalUrl}`;
    res.redirect(301, redirectUrl);
    return;
  }
  next();
});

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// CORS: allow only explicitly-listed origins and Replit-owned TLDs.
// Never use origin:true (reflects arbitrary origins) with credentials:true.

// Replit-owned TLDs — no third party can issue subdomains under these.
const REPLIT_TRUSTED_SUFFIXES = [".replit.dev", ".repl.co", ".replit.app"];

const allowedOrigins = (() => {
  // Primary: REPLIT_DOMAINS lists every domain alias Replit assigns the repl.
  const replitDomains = (process.env["REPLIT_DOMAINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((d) => `https://${d}`);

  // Fallback: REPLIT_DEV_DOMAIN for environments that don't supply REPLIT_DOMAINS.
  const devDomain = process.env["REPLIT_DEV_DOMAIN"]
    ? [`https://${process.env["REPLIT_DEV_DOMAIN"]}`]
    : [];

  // Expo mobile web preview runs on a separate subdomain.
  // Note: *.expo.janeway.replit.dev ends in .replit.dev so it is already covered
  // by REPLIT_TRUSTED_SUFFIXES, but we add it explicitly for clarity.
  const expoDomain = process.env["REPLIT_EXPO_DEV_DOMAIN"]
    ? [`https://${process.env["REPLIT_EXPO_DEV_DOMAIN"]}`]
    : [];

  // Custom origins from operator config (e.g. production custom domains).
  const extra = (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const base = replitDomains.length > 0 ? replitDomains : [...devDomain, ...expoDomain];
  return [...new Set([...base, ...expoDomain, ...extra])];
})();

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.includes(origin)) return true;
  // Safety-net: accept any subdomain of a Replit-owned TLD without manual config.
  try {
    const hostname = new URL(origin).hostname;
    return REPLIT_TRUSTED_SUFFIXES.some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

// Log allowed origins at startup so mismatches are diagnosable immediately.
logger.info(
  { allowedOrigins, trustedSuffixes: REPLIT_TRUSTED_SUFFIXES },
  "CORS: allowed origins",
);

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // No Origin header = server-to-server call; always allow.
      if (!origin) {
        callback(null, true);
        return;
      }
      // In production with no allowlist configured, fail closed.
      if (allowedOrigins.length === 0) {
        if (process.env["NODE_ENV"] !== "production") {
          // Dev-only: fail open so a local Vite preview works without env setup.
          callback(null, true);
        } else {
          // Return false so cors calls next(); the 403 guard below fires.
          callback(null, false);
        }
        return;
      }
      // Return false on rejection — cors will call next() and the guard below
      // responds with a proper 403 instead of letting Express emit a 500.
      callback(null, isAllowedOrigin(origin));
    },
  }),
);

// Return HTTP 403 for CORS-rejected cross-origin requests.
// When cors() receives callback(null, false) it calls next() without setting
// Access-Control-Allow-Origin, so we detect the rejection here.
app.use((req, res, next) => {
  const origin = req.headers.origin as string | undefined;
  if (origin && !res.getHeader("Access-Control-Allow-Origin")) {
    logger.warn({ origin }, "CORS: origin rejected");
    res.status(403).json({ error: "CORS: origin not allowed" });
    return;
  }
  next();
});
// Raw body needed for Stripe webhook signature verification — must come BEFORE express.json()
app.use("/api/billing/webhook", express.raw({ type: "application/json" }));

app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

export default app;
