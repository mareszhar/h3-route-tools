import { Hono } from "hono";

export const health = new Hono().get("/health", (c) =>
  c.json({ status: "ripe" as const, at: new Date().toISOString() }, 200)
);
