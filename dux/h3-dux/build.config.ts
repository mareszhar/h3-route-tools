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
