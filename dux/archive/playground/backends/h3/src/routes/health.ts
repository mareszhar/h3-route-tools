import type { H3 } from "h3";

export function healthRoutes(app: H3) {
  app.get("/health", () => ({ status: "ripe" as const, at: new Date().toISOString() }));
}
