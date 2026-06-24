# proposal expert X

My honest verdict: h3-dux has a genuinely good core idea and several excellent API choices, but it is not yet more delightful than Hono or Elysia overall.

The next step should not be rewriting H3’s runtime. It should be taking ownership of h3-dux’s public contract types instead of letting upstream implementation types leak through them.

## The central architectural recommendation

Introduce a small, normalized h3-dux contract kernel:

```TS
interface EndpointContract {
  request: {
    params: unknown
    query: unknown
    headers: unknown
    body: unknown
  }
  responses: {
    [status: number]: {
      body: unknown
      kind: 'json' | 'text' | 'empty' | 'sse' | 'binary'
    }
  }
}
```

Schemas should be resolved into plain public shapes when an endpoint is accumulated. The client, Nitro generation, composition, diagnostics, and OpenAPI should all consume this normalized contract.

Currently, `DuxEndpoint<V, P, Ret, Route>` retains schema-heavy generic arguments, so TypeScript exposes Valibot and route machinery in diagnostics ([route-types.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/internal/route-types.ts:184)). A plain contract boundary would stop that leakage.

This is not a rewrite of upstream routing or validation. It is a deliberate divergence in the type layer, where h3-dux’s value lives.

## 1. Cleaner inference and diagnostics

This is very feasible.

The example diagnostic has two immediate causes:

- `PathTemplate<P>` returns static paths unchanged, so `/fruits` matches both client overloads ([client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.ts:62)).
- The inferred `O & NoExcess<O, Expected>` options signature makes TypeScript explain the generic machinery instead of the actual body error ([client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.ts:97)).

I would:

1. Generate the interpolation overload only for parameterized routes.
2. Contextually type options directly as `VerbOptions<Endpoint>` instead of introducing generic `O`.
3. Let native object-literal excess-property checking do its job.
4. Store resolved endpoint shapes as plain object types, with no schemas in the public route map.
5. Prettify the final serialized data type at the public boundary.

That should turn the missing-field diagnostic into something close to:

```text
Property 'stockKg' is missing in type ...
but required in type ...
```

Custom branded type errors are tempting, but usually make completions and error chains worse. Native TypeScript diagnostics over clean public shapes are the better target.

The current Selenita test only proves that some “not assignable” error exists ([client.dx.test.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.dx.test.ts:30)). The DX contract should assert:

- exactly one diagnostic;
- the diagnostic mentions `stockKg`;
- it says missing/required;
- it is attached to `body` or the body literal;
- hover output is a readable public type;
- source and built declaration modes match;
- editor response time remains acceptable at 100, 500, and perhaps 1,000 routes.

All 27 current tests pass, but they do not guard the quality you care about.

## 2. Client data and errors

I recommend three coherent client modes.

### Default: data-first and throwing

```TS
const created = await api.post('/fruits', {
  body: { name: 'Lychee', emoji: '🫐', pricePerKg: 12, stockKg: 3 },
})
// created: Fruit
```

This should parse according to the declared response kind and throw on a non-success response.

```TS
try {
  await api.get(`/fruits/${id}`)
}
catch (error) {
  if (error instanceof DuxError) {
    error.status
    error.data
    error.response
  }
}
```

This is the best everyday API and follows `$fetch`, ofetch, and Hono’s newer `parseResponse()` direction.

### `api.raw`: web-standard response

```TS
const response = await api.raw.post('/fruits', { body })

response.status
response.headers
const body = await response.json()
```

Raw should not throw merely because the status is non-2xx. Ideally it should be a status-discriminated response union:

```TS
if (response.status === 201)
  await response.json() // Fruit

if (response.status === 409)
  await response.json() // ConflictError
```

### `api.try`: typed result

```TS
const result = await api.try.post('/fruits', { body })

if (result.ok) {
  result.data
}
else if (result.kind === 'http') {
  switch (result.status) {
    case 401:
      result.error
      break
    case 409:
      result.error
      break
  }
}
```

This is where endpoint-specific errors belong. TypeScript does not support typed `throws`, so a catch block cannot automatically recover which endpoint produced an exception. Elysia’s typed error narrowing works because Treaty returns a result envelope.

Supporting both throwing and result styles is not redundant: they solve different problems.

### Error contracts must become first-class

Today, errors are mostly runtime/OpenAPI metadata, while the client assumes `.json()` contains the success body even for a 404. That is a real type-safety hole.

I would add:

```TS
.post('/fruits', {
  status: 201,
  validate: {
    body: NewFruitSchema,
    response: FruitSchema,
  },
  errors: {
    401: ErrorSchema,
    409: ErrorSchema,
  },
  handler: ...
})
```

Potentially with a cursor-typed helper:

```TS
throw event.error(409, {
  error: 'already_exists',
  message: 'That fruit already exists',
})
```

The `errors` map should feed runtime validation, OpenAPI, `api.raw`, and `api.try`. One declaration, four consumers.

I would also make validation failures consistent. Eager validation currently produces 400 while manual validation produces 422. The same malformed request should not change status because the handler selected a different validation mode. I would standardize on 422.

## 3. Nitro and file-based routes

Automatic client typing is both ideal and feasible.

The current module already has almost everything required: `collectRouteHandlers()` knows the generated Nitro route path, module import, and declared methods ([nitro.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/src/nitro.ts:70)). The manual map in the demo should therefore be generated rather than written by hand ([client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/demo/nitro/client.ts:9)).

During `nitro prepare`, dev, and build, emit something like:

```TS
// generated
export type Routes = {
  '/health': ...
  '/fruits': ...
  '/fruits/:id': ...
}
```

Then:

```TS
import type { Routes } from '#h3-dux/routes'

export const api = createClient<Routes>()
```

A later refinement could ambiently supply the generated contract so a single-API Nitro project can simply call `createClient()`.

The same client API—including interpolation—can work perfectly:

```TS
api.get('/fruits/:id', { params: { id } })
api.get(`/fruits/${id}`)
```

### The server-side filename limitation

An ordinary TypeScript function cannot know the filename containing its call. Therefore this cannot be solved solely through clever generics:

```TS
// TypeScript cannot infer "/fruits/:id" from this file's name.
defineRouteHandler({
  handler: event => event.context.params.id,
})
```

The realistic choices are:

- declare a params schema, which already gives typed/coerced params;
- repeat the route string explicitly;
- build a TypeScript language-service/plugin transform.

I would avoid the third initially. It is a lot of machinery for relatively little gain.

The most pragmatic Nitro design is:

- file path remains the runtime route source;
- `validate.params` types server params;
- generated route metadata powers the client automatically;
- prepare/build verifies that schema param keys match filename params;
- optionally allow an explicit route string for users wanting filename-free type inference, and verify that it matches the filesystem route.

Nitro also needs a dux-native handler surface. Right now Nitro uses inherited `defineRouteHandler`, so standalone response inference, validation modes, and SSE are not truly at parity.

## 4. Current API quality review

What is excellent:

- `createServer` ↔ `createClient`.
- `app.get` ↔ `api.get`.
- Interpolated and keyed path params.
- Response inference from handlers in standalone mode.
- Wire-shape serialization.
- Standard Schema independence.
- Eager/manual validation.
- Typed SSE as an ergonomic goal.
- Type-only server contract imports.
- Web-standard/in-process transport flexibility.

What I would change:

- Make all `createClient` forms data-first, including the callable form. Put native responses exclusively under `api.raw`.
- Put `params` inside `validate` on the dux surface. The conventions describe one validation block, but the implementation keeps params top-level.
- Remove `event.validated` from the public type, not merely the documentation.
- Standardize validation status and envelope.
- Detect duplicate route+method definitions instead of silently applying first-wins.
- Make `status: 201` part of the route contract, not just runtime behavior.
- Properly model 204, HEAD, OPTIONS, text, binary, and native `Response` returns.
- Add `signal`, timeouts, interceptors, retry policy, and better query serialization without polluting endpoint diagnostics.
- Rename the `.app` escape hatch to something clearer such as `.native`; more importantly, routes added through it currently do not accumulate into `~duxRoutes`.
- Harden SSE. The current parser does not check `response.ok`, only reads one `data:` line, and does not handle CRLF or multiline events ([sse.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/sse.ts:29)).

A major underexplored feature is typed middleware context. Elysia and Hono let middleware/plugins contribute typed context. h3-dux currently accepts ordinary H3 middleware, but a middleware-provided `user`, `session`, or database does not naturally accumulate into subsequent handlers. Auth need not become an h3-dux concept, but typed context composition should.

## 5. Modularity and scale

The upstream engine is modular. It has `defineRoute`, route maps, `mountRoutes`, and typed `H3Typed.register` ([routes.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/src/routes.ts:88)).

The primary h3-dux surface is not yet modular enough. `DuxServer` only exposes `use` and verbs ([server.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/server.ts:187)). Using the upstream composition primitives means leaving the dux deltas behind.

I would introduce one first-class primitive:

```TS
const fruits = createRouter('/fruits')
  .get('/', ...)
  .post('/', ...)
  .get('/:id', ...)

const checkout = createRouter()
  .post('/checkout', ...)

export const app = createServer()
  .use(observability)
  .mount(fruits)
  .mount(checkout)
```

A one-endpoint file can export a router containing one endpoint. A domain can export twenty. The parent should preserve:

- prefixed route literals;
- request and response contracts;
- errors;
- middleware context;
- OpenAPI;
- client inference;
- duplicate-route diagnostics.

This should be a dux-native router, not merely a type alias over upstream plugins, because it must carry the dux contract kernel and all dux behavior.

## 6. Hono and Elysia comparison

| Area | h3-dux today | Hono | Elysia |
|---|---|---|---|
| Server verb ergonomics | Strong | Strong | Strong |
| Client happy path | Weak: double await | Raw response; data helper available | Parsed result |
| Typed HTTP errors | Missing | Status-typed response unions | Best current narrowing |
| Path ergonomics | Excellent | Proxy/tree syntax | Proxy/tree syntax |
| Response inference | Strong standalone | Strong | Strong |
| Modularity | Weak on dux surface | Strong sub-apps | Excellent plugins/scopes |
| Typed middleware context | Limited | Strong | Excellent |
| SSE consumption | Excellent concept, incomplete hardening | Mostly manual | Strong |
| Nitro file-route integration | Promising differentiator | Not native | Not native |
| Diagnostic quality | Currently poor | Complex at scale | Generally polished |
| IDE scaling | Unknown | Documented scaling issues | Designed around smaller instances |

So: no, h3-dux is not ahead overall yet.

It is already more appealing in a few specific areas—literal-path client calls, interpolation, validation control, H3/Nitro alignment—but Elysia currently has the more complete end-to-end experience, particularly around errors and composition. Hono is more mature and modular, though its RPC types have acknowledged IDE-scaling costs.

How h3-dux can surpass them:

1. Best-in-class cursor diagnostics, enforced by Selenita.
2. Data-first, raw, and typed-result consumption from one contract.
3. Fully typed status/error maps.
4. Automatic Nitro file-route contract generation.
5. A composable router with typed middleware context.
6. A deliberately flattened/precompiled contract that remains fast for large apps.
7. Keep the literal-path API instead of adopting proxy trees.
8. Preserve H3/Nitro/Web Standard interoperability underneath.

That combination would be genuinely distinctive, rather than “H3 with nicer verbs.”

## Recommended order

1. Fix and lock the current client diagnostics.
2. Specify the normalized status-aware contract kernel.
3. Make `createClient` data-first; add `api.raw` and `api.try`.
4. Promote errors into the endpoint contract.
5. Add `createRouter` and typed `mount`.
6. Generate Nitro route contracts automatically and bring Nitro handlers to dux parity.
7. Harden SSE, response kinds, middleware context, and large-app type performance.

I mostly agree with the other agent’s immediate recommendations, but I would not postpone typed errors as an unrelated later feature. The response contract chosen now determines whether errors, raw responses, Nitro, OpenAPI, and composition can remain coherent later.

Sources: [Elysia Treaty responses](https://elysiajs.com/eden/treaty/response), [Elysia plugins](https://elysiajs.com/essential/plugin), [Hono RPC](https://hono.dev/docs/guides/rpc), [ofetch](https://github.com/unjs/ofetch), [Nuxt `$fetch`](https://nuxt.com/docs/4.x/api/utils/dollarfetch), [Nuxt `useFetch`](https://nuxt.com/docs/4.x/api/composables/use-fetch), [Nitro routing](https://nitro.build/docs/routing), [H3 errors](https://h3.dev/guide/basics/error), [Selenita](https://github.com/mareszhar/selenita).
