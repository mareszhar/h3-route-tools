# proposal expert B

> Historical draft. This memo predates Generation 2 and is kept as design archaeology only. It is superseded by [dux-vision.md](../dux-vision.md), [dux-language.md](../dux-language.md), [dux-patterns.md](../dux-patterns.md), and [dux-spec.md](../dux-spec.md); do not treat recommendations or status claims here as current h3-dux guidance.

The short version:

- Yes, upstream `h3-route-tools` also returns a typed native `Response`, so it requires `await res.json()`.
- Nuxt’s `$fetch` returns decoded data directly. `{ data, error }` comes from `useFetch`, not `$fetch`.
- H3’s web-standard direction does not require h3-dux’s high-level client to expose raw `Response` by default.
- Passing `app.request` is correct for an in-process demo/test, but browser clients should import only the app type and use `baseURL`.
- The bad diagnostic is fixable mostly inside h3-dux’s client types. It does not require rewriting upstream.
- My recommendation: make `createClient` data-first, throw on non-2xx, and provide `api.raw` for the native response.

## What happens today

Upstream explicitly defines `TypedResponse<T>` as a native `Response` whose `.json()` is typed, then returns it from `createTypedFetch`:

[src/typed-fetch.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/src/typed-fetch.ts:5)

```TS
const response = await api(...)
const data = await response.json()
```

h3-dux’s verb methods deliberately mirror this:

[dux/h3-dux/src/client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.ts:54)

So yes: this behavior comes from upstream, and the upstream files are unchanged relative to `main`.

The outer response gives you:

- `ok`
- `status` and `statusText`
- headers
- URL/redirect information
- the raw body stream
- `.json()`, `.text()`, `.blob()`, etc.

`.json()` is part of the Fetch `Response` standard. It has nothing to do with OpenAPI; OpenAPI describes the HTTP contract.

H3 v2’s web-standard direction means handlers are converted to web `Response` objects and transports accept/return standard `Request`/`Response`. It does not prescribe the ergonomics of a higher-level SDK.

## Nuxt’s behavior

The exact distinction is:

```TS
const data = await $fetch('/api/fruits')
```

versus:

```TS
const { data, error, status } = await useFetch('/api/fruits')
```

`$fetch` is powered by `ofetch`, not native `fetch`. It parses JSON automatically and throws when `response.ok` is false. `ofetch.raw()` is the escape hatch for response metadata.

That split is very applicable to h3-dux.

## Errors under the current client

At present, a server-thrown error is handled by H3 and becomes an HTTP error response. The client does not throw merely because the status is 400/404/500:

```TS
const response = await api.get('/missing')

response.ok     // false
response.status // 404
await response.json()
```

Only transport failures normally reject the promise.

There is also a type-safety hole: `.json()` remains typed as the successful response body even when `response.ok === false`, although the runtime body is an error envelope. The demo’s invalid request demonstrates this.

So simply changing the implementation to auto-call `.json()` without checking `ok` would be wrong: an error payload could masquerade as a successful `Fruit`.

## My recommended client design

Make `createClient` the delightful, data-first surface:

```TS
const created = await api.post('/fruits', {
  body: { name: 'Lychee', emoji: '🫐', pricePerKg: 12, stockKg: 3 },
})
// created: Fruit
```

For metadata or low-level behavior:

```TS
const response = await api.raw.post('/fruits', {
  body,
})

response.status
response.headers
const created = await response.json()
```

On non-2xx, the data-first client should throw something like:

```TS
class DuxFetchError extends Error {
  response: Response
  status: number
  data: unknown
}
```

Therefore:

```TS
try {
  const fruit = await api.get('/fruits/missing')
}
catch (error) {
  if (error instanceof DuxFetchError) {
    console.log(error.status)
    console.log(error.data)
  }
}
```

This gives the happy path one await without discarding standards: the implementation still uses standard Fetch underneath, and the standard `Response` remains available through `api.raw`.

I would not use a per-call `{ raw: true }` option. It adds another conditional generic to an already complicated options signature and makes IntelliSense worse. A separate `api.raw` namespace is clearer and discoverable.

I would also keep upstream’s `createTypedFetch` untouched as the raw primitive. Only h3-dux’s opinionated `createClient` needs the data-first behavior.

### Other viable options

1. **Keep raw response as default.** Most standards-pure, least aligned with “delightful” and “boilerplate is harm.”

2. **Data-first + `api.raw` — recommended.** Nuxt/ofetch-like happy path, web-standard escape hatch, safe error behavior.

3. **Result union by default.**

   ```TS
   const result = await api.post(...)
   if (result.ok)
     result.data
   else
     result.error
   ```

   Explicit, but noisy for every successful call. It also becomes truly valuable only after endpoint error responses are part of the route type contract. Currently upstream’s `errors` option primarily feeds OpenAPI, not the client endpoint type.

A future opt-in `api.try.post(...)` could return a discriminated result. I would not make it the primary client.

## Is passing `app` to `createClient` safe?

The demo is not actually passing the app object into `createClient`. It passes:

```TS
createClient<App>({ fetch: app.request })
```

[demo/main.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/demo/main.ts:8)

There are two separate things here:

- `App` is a compile-time type and disappears from emitted JavaScript.
- `app.request` is a runtime transport function that routes requests directly into the same in-process server.

That is excellent for tests, demos, SSR internals, and server-to-server in-process calls. It avoids opening a network socket.

It is not the browser pattern. Browser code should look like:

```TS
import type { App } from '../server'

export const api = createClient<App>({
  baseURL: '/api',
})
```

No server app or schemas are included at runtime. The Nitro demo already uses the equivalent type-only route-map pattern:

[demo/nitro/client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/demo/nitro/client.ts:1)

If browser code imported the actual `app`, the concern would not be extra authority over Vercel. Authorization still happens server-side. The danger would be bundling server implementation details, constants, schemas, or accidentally imported secrets into the client bundle.

The client currently does no schema runtime validation. The server validates. If client-side validation is desired, schemas must be imported explicitly—but the server must still validate because the browser is untrusted.

So the implementation is not broken; the standalone demo is deliberately in-process. It may deserve a louder comment or a dedicated `createTestClient(app)` convenience to prevent people copying it into browser code.

## Why the diagnostic is so bad

There are two separate causes.

First, static routes accidentally match both overloads. `PathTemplate<P>` returns `P` unchanged when there is no `:param`, so `/fruits` appears in both the literal-route and interpolation overloads:

[client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.ts:62)  
[client.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.ts:116)

That is why TypeScript prints “Overload 1 of 2” and then repeats essentially the same error. The interpolation overload should be generated only from routes containing parameters.

Second, the options signature layers together:

- a generic inferred `O`
- `VerbOptions`
- `NoExcess`
- intersections
- endpoint-resolution conditionals
- the schema-derived `DuxEndpoint`

That forces TypeScript to expose its entire reasoning process rather than simply reporting the expected body shape.

The `NoExcess` machinery is especially questionable here. It prevents unknown top-level client option keys, but it does not make nested body objects exact. It exacts a large diagnostic cost for limited protection.

## Feasibility of improving it

This is very feasible without reimplementing upstream.

The verb client types are already h3-dux-owned reconstruction code, not upstream types. I would approach it in this order:

1. Make the literal and interpolated overloads disjoint. This immediately removes the duplicate half of the error.

2. Pass the resolved `VerbOptions` directly as the contextual type instead of inferring `O & NoExcess<...>`. Native object-literal checking should then produce something close to:

   ```text
   Property 'stockKg' is missing in type ... but required in type ...
   ```

3. If schema internals still leak, normalize each route endpoint into a plain public client contract before constructing the method signature.

4. Prefer native TypeScript diagnostics over branded “custom error” types. Custom type-error strings often damage completions and make messages even stranger.

This is a small-to-medium client type refactor. A much larger refactor would only be needed if you decide to add fully typed status/error response maps across standalone, Nitro codegen, and OpenAPI.

## Selenita assessment

Selenita is wired, but the current test does not enforce delightful diagnostics:

[client.dx.test.ts](/Users/mares/Base/Projects/Practice/h3-route-tools/dux/h3-dux/src/client.dx.test.ts:30)

It merely checks:

```TS
expect(errors).toHaveError(/not assignable/)
```

That proves an error exists, not that it is useful.

I ran the current suite: all 27 tests pass with no type errors. The suite is green because this failure mode is not covered.

The editor-DX contract should additionally assert:

- exactly one diagnostic
- diagnostic mentions `stockKg`
- diagnostic says it is missing/required
- diagnostic lands on `body` or the body object
- hover snapshots remain readable
- source and built `.d.mts` behave alike using Selenita’s mode matrix

So I agree with your assessment: the stated Selenita bar was not met. The tool is present; the quality criteria were underspecified.

## My prioritization

I would treat these as the next three DX improvements:

1. **Data-first `createClient`, with `api.raw` and thrown HTTP errors.**
2. **Simplify/disjoint the verb overloads and lock the diagnostic with Selenita.**
3. **Define an explicit typed-error contract later**, then consider an opt-in result-style `api.try`.

That direction fits the dux hierarchy rather cleanly: delight and low boilerplate first, standards preserved underneath, and errors that are honest both at runtime and at the cursor.

### Sources

- [Nuxt `$fetch`](https://nuxt.com/docs/4.x/api/utils/dollarfetch)
- [Nuxt `useFetch`](https://nuxt.com/docs/4.x/api/composables/use-fetch)
- [ofetch behavior and `.raw`](https://github.com/unjs/ofetch)
- [H3 web-standard responses](https://h3.dev/guide/basics/response)
- [Fetch error/status semantics](https://developer.mozilla.org/en-US/docs/Web/API/Window/fetch)
- [Selenita README](https://raw.githubusercontent.com/mareszhar/selenita/refs/heads/main/README.md)
