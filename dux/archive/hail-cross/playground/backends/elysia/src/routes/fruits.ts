import {
  ErrorSchema,
  FruitPageSchema,
  FruitPatchSchema,
  FruitQuerySchema,
  FruitSchema,
  NewFruitSchema,
} from "@orchard/domain";
import { Elysia } from "elysia";
import { auth } from "../plugins/auth.ts";
import { context } from "../plugins/context.ts";

/** CRUD for fruits. Reads are open; writes require the `requireKey` macro. */
export const fruits = new Elysia({ prefix: "/fruits", name: "orchard/fruits" })
  .use(context)
  .use(auth)
  .get("/", ({ orchard, query }) => orchard.list(query), {
    query: FruitQuerySchema,
    response: FruitPageSchema,
  })
  .get("/:id", ({ orchard, params }) => orchard.get(params.id), {
    response: { 200: FruitSchema, 404: ErrorSchema },
  })
  .post("/", ({ orchard, body, status }) => status(201, orchard.create(body)), {
    body: NewFruitSchema,
    requireKey: true,
    response: { 201: FruitSchema, 401: ErrorSchema, 409: ErrorSchema },
  })
  .patch("/:id", ({ orchard, params, body }) => orchard.update(params.id, body), {
    body: FruitPatchSchema,
    requireKey: true,
    response: { 200: FruitSchema, 401: ErrorSchema, 404: ErrorSchema },
  })
  .delete(
    "/:id",
    ({ orchard, params, status }) => {
      orchard.remove(params.id);
      return status(204);
    },
    {
      requireKey: true,
    }
  );
