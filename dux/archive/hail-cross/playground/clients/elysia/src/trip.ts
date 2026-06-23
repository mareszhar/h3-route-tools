import type { App } from "@orchard/backend-elysia";
import { treaty } from "@elysiajs/eden";
import { narrate, ORCHARD_KEY, ORCHARD_KEY_HEADER } from "@orchard/domain";

const auth = { headers: { [ORCHARD_KEY_HEADER]: ORCHARD_KEY } };

/** Build an Eden Treaty client from an Elysia instance (in-process) or a URL. */
export function makeElysiaClient(target: Parameters<typeof treaty<App>>[0]) {
  return treaty<App>(target);
}

export type ElysiaClient = ReturnType<typeof makeElysiaClient>;

/** The narrated Eden Treaty shopping trip, shared by the Elysia and Nitro-Elysia clients. */
export async function runElysiaTrip(label: string, api: ElysiaClient): Promise<void> {
  narrate.banner(label);

  narrate.step("GET /health");
  const health = await api.health.get();
  narrate.ok("orchard is", health.data?.status);

  narrate.step("GET /fruits — filter + sort + cursor pagination");
  const page1 = await api.fruits.get({ query: { sort: "price", limit: 2 } });
  narrate.ok(
    "page 1",
    page1.data?.items.map((f) => f.emoji)
  );
  const page2 = await api.fruits.get({
    query: { sort: "price", limit: 2, cursor: page1.data?.nextCursor ?? undefined },
  });
  narrate.ok(
    "page 2",
    page2.data?.items.map((f) => f.emoji)
  );

  narrate.step("GET /fruits/:id");
  const apple = await api.fruits({ id: "apple" }).get();
  narrate.ok("fetched", `${apple.data?.emoji} ${apple.data?.name}`);

  narrate.step("GET /fruits/:id — missing → typed 404");
  const missing = await api.fruits({ id: "dragonfruit" }).get();
  if (missing.error?.status === 404) narrate.expected("narrowed error.value", missing.error.value);

  narrate.step("POST /fruits — no key → typed 401");
  const denied = await api.fruits.post({
    name: "Mango",
    emoji: "🥭",
    color: "orange",
    tags: ["sweet"],
    pricePerKg: 5,
    stockKg: 12,
  });
  if (denied.error?.status === 401)
    narrate.expected("guard rejected the write", denied.error.value);

  narrate.step("POST /fruits — with key → 201");
  const created = await api.fruits.post(
    {
      name: "Mango",
      emoji: "🥭",
      color: "orange",
      tags: ["sweet", "tropical"],
      pricePerKg: 5,
      stockKg: 12,
    },
    auth
  );
  narrate.ok("created", `${created.data?.emoji} ${created.data?.name} (${created.status})`);

  narrate.step("PATCH /fruits/:id — ripen the mango");
  const patched = await api.fruits({ id: "mango" }).patch({ ripeness: 95 }, auth);
  narrate.ok("ripeness now", patched.data?.ripeness);

  narrate.step("POST /checkout — out of stock → typed 409");
  const broke = await api.checkout.post({ items: [{ id: "kiwi", kg: 9999 }] });
  if (broke.error?.status === 409) narrate.expected("domain error", broke.error.value);

  narrate.step("POST /checkout — a real basket");
  const receipt = await api.checkout.post({
    items: [
      { id: "kiwi", kg: 2 },
      { id: "mango", kg: 1 },
    ],
  });
  narrate.ok("receipt total", `$${receipt.data?.total}`);

  narrate.step("GET /fruits/:id/ripen — Server-Sent Events");
  const { data: ticks } = await api.fruits({ id: "banana" }).ripen.get();
  for await (const tick of ticks ?? []) narrate.info(`🍌 ripeness → ${tick.data.ripeness}`);

  narrate.step("DELETE /fruits/:id");
  const removed = await api.fruits({ id: "mango" }).delete(undefined, auth);
  narrate.ok("deleted mango", removed.status);

  narrate.done(`${label} complete — every call fully typed end-to-end`);
}
