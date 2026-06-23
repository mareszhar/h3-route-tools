import { H3 } from "h3";
import { errorBoundary } from "./middleware/errors.ts";
import { observability } from "./middleware/observability.ts";
import { checkoutRoutes } from "./routes/checkout.ts";
import { fruitRoutes } from "./routes/fruits.ts";
import { healthRoutes } from "./routes/health.ts";
import { streamRoutes } from "./routes/stream.ts";

/** The composed Orchard app. `app.fetch` powers the in-process h3 client. */
export const app = new H3({ silent: true }).use(errorBoundary).use(observability);

for (const register of [healthRoutes, fruitRoutes, checkoutRoutes, streamRoutes]) register(app);
