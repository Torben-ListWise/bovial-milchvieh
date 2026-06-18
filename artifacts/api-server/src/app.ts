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

// CORS: allow only the Replit dev domain and any configured ALLOWED_ORIGINS.
// Never use origin:true (reflects arbitrary origins) with credentials:true.
const allowedOrigins = (() => {
  const base = process.env["REPLIT_DEV_DOMAIN"]
    ? [`https://${process.env["REPLIT_DEV_DOMAIN"]}`]
    : [];
  const extra = (process.env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [...base, ...extra];
})();

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => {
      // No Origin header = server-to-server call; always allow.
      if (!origin) {
        callback(null, true);
        return;
      }
      // In production with no allowlist configured, fail closed to prevent
      // credentialed cross-origin access from arbitrary origins.
      if (allowedOrigins.length === 0) {
        if (process.env["NODE_ENV"] !== "production") {
          // Dev-only: fail open so the local Vite preview works without env setup.
          callback(null, true);
        } else {
          callback(new Error("CORS: no allowed origins configured in production"));
        }
        return;
      }
      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`Origin ${origin} not allowed by CORS`));
      }
    },
  }),
);
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
