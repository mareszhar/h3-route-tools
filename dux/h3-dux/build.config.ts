import { defineBuildConfig } from 'obuild/config'

// Three entrypoints, with runtime peers and heavy node-only tooling kept
// external. h3-dux owns its route implementation; there is no upstream package
// to re-export or depend on.
export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: ['./src/index.ts'],
      rolldown: {
        platform: 'neutral',
        external: ['h3'],
      },
    },
    {
      // The client plane on its own subpath. Its graph carries no runtime `h3`
      // value import, so this bundle resolves in any consumer — h3 v1, v2, or
      // none (e.g. a Nuxt 4 / Nitro v2 app talking to a dux API). `h3` stays
      // external only as a belt-and-suspenders; the client never imports it.
      type: 'bundle',
      input: ['./src/client.ts'],
      rolldown: {
        platform: 'neutral',
        external: ['h3'],
      },
    },
    {
      type: 'bundle',
      input: ['./src/codegen.ts'],
      rolldown: {
        platform: 'node',
        external: ['typescript', 'h3'],
      },
    },
    {
      type: 'bundle',
      input: ['./src/nitro.ts'],
      rolldown: {
        platform: 'node',
        external: ['h3', 'nitro', 'nitro/types'],
      },
    },
  ],
})
