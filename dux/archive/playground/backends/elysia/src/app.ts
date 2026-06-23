import { Elysia } from "elysia";
import { errors } from "./plugins/errors.ts";
import { observability } from "./plugins/observability.ts";
import { checkout } from "./routes/checkout.ts";
import { fruits } from "./routes/fruits.ts";
import { health } from "./routes/health.ts";
import { stream } from "./routes/stream.ts";

/** The composed Orchard app. `App` is consumed by the Eden Treaty client. */
export const app = new Elysia()
  .use(observability)
  .use(errors)
  .use(health)
  .use(fruits)
  .use(checkout)
  .use(stream);

export type App = typeof app;
