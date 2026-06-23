import { OrchardError } from "@orchard/domain";
import { Elysia } from "elysia";

/** Maps domain errors and validation failures onto the shared error envelope. */
export const errors = new Elysia({ name: "orchard/errors" }).onError(
  { as: "global" },
  ({ error, code, status }) => {
    if (error instanceof OrchardError) return status(error.status, error.toBody());

    if (code === "VALIDATION") {
      // Elysia serialises validation detail as a JSON string; lift the concise summary.
      let message = "Request failed validation";
      try {
        message = JSON.parse(error.message).message ?? message;
      } catch {
        /* keep the fallback */
      }
      return status(422, { error: "validation", message });
    }

    if (code === "NOT_FOUND")
      return status(404, { error: "not_found", message: "No route here 🤷" });

    return status(500, { error: "internal", message: "Something bruised in the orchard 🍂" });
  }
);
