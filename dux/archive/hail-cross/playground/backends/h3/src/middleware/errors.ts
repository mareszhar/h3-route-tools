import type { Middleware } from "h3";
import { OrchardError } from "@orchard/domain";

/**
 * Outermost middleware: catches anything thrown downstream and renders the
 * shared Orchard error envelope. Domain errors carry their own status; h3's
 * validation errors arrive as 422 with `data.error = 'validation'`.
 */
export const errorBoundary: Middleware = async (event, next) => {
  try {
    return await next();
  } catch (err) {
    if (err instanceof OrchardError) return Response.json(err.toBody(), { status: err.status });

    const e = err as { status?: number; data?: { error?: string }; message?: string };
    const status = e.status ?? 500;
    return Response.json(
      {
        error: e.data?.error ?? (status === 422 ? "validation" : "internal"),
        message: e.message ?? "Something bruised in the orchard 🍂",
      },
      { status }
    );
  }
};
