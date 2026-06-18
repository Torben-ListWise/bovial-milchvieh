import { Router, type IRouter, type Request, type Response } from "express";
import { GetCurrentUserResponse } from "@workspace/api-zod";
import { requireAuth } from "../lib/auth";

const router: IRouter = Router();

router.get("/me", requireAuth, (req: Request, res: Response) => {
  const u = req.appUser!;
  res.json(
    GetCurrentUserResponse.parse({
      id: u.id,
      email: u.email ?? null,
      name: u.name ?? null,
      role: u.role === "operator" ? "operator" : "customer",
    }),
  );
});

export default router;
