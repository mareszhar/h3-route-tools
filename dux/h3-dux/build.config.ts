import { defineBuildConfig } from 'obuild/config'

// Mirrors h3-route-tools' own obuild setup: three bundle entries, with the
// upstream package and its heavy node-only peers kept external so we re-export
// rather than re-bundle them.
export default defineBuildConfig({
  entries: [
    {
      type: 'bundle',
      input: ['./src/index.ts'],
      rolldown: {
        platform: 'neutral',
        external: ['h3-route-tools'],
      },
    },
    {
      type: 'bundle',
      input: ['./src/codegen.ts'],
      rolldown: {
        platform: 'node',
        external: ['typescript', 'h3-route-tools', 'h3-route-tools/codegen'],
      },
    },
    {
      type: 'bundle',
      input: ['./src/nitro.ts'],
      rolldown: {
        platform: 'node',
        external: ['nitro', 'nitro/types', 'h3-route-tools', 'h3-route-tools/nitro'],
      },
    },
  ],
})
