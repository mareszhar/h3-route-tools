import type { H3 } from "h3";
import { FruitPatchSchema, FruitQuerySchema, NewFruitSchema } from "@orchard/domain";
import { defineHandler, getRouterParam, getValidatedQuery, readValidatedBody } from "h3";
import { requireKey } from "../middleware/auth.ts";
import { orchard } from "../orchard.ts";
import { validationOptions } from "../validate.ts";

/** CRUD for fruits. Reads are open; writes carry the `requireKey` middleware. */
export function fruitRoutes(app: H3) {
  app
    .get("/fruits", async (event) =>
      orchard.list(await getValidatedQuery(event, FruitQuerySchema, validationOptions))
    )

    .get("/fruits/:id", (event) => orchard.get(getRouterParam(event, "id")!))

    .post(
      "/fruits",
      defineHandler({
        middleware: [requireKey],
        handler: async (event) => {
          const fruit = orchard.create(
            await readValidatedBody(event, NewFruitSchema, validationOptions)
          );
          event.res.status = 201;
          return fruit;
        },
      })
    )

    .patch(
      "/fruits/:id",
      defineHandler({
        middleware: [requireKey],
        handler: async (event) =>
          orchard.update(
            getRouterParam(event, "id")!,
            await readValidatedBody(event, FruitPatchSchema, validationOptions)
          ),
      })
    )

    .delete(
      "/fruits/:id",
      defineHandler({
        middleware: [requireKey],
        handler: (event) => {
          orchard.remove(getRouterParam(event, "id")!);
          event.res.status = 204;
          return null;
        },
      })
    );
}
