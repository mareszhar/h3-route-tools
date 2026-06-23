import antfu from '@antfu/eslint-config'

export default antfu(
  {
    formatters: true,
    typescript: true,
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.nitro/**',
      '**/.output/**',
      '**/.turbo/**',
      '**/packs/**',
      // The archive is a frozen reference kept in its original upstream/ox
      // formatting — we don't reformat it to our house style. See
      // docs/dux-spec-workspace.md §2.
      'archive/**',
    ],
  },
  {
    files: ['**/*.md'],
    rules: {
      'format/prettier': 'off',
    },
  },
  {
    // Code fences in docs are illustrations, not compiled source — keep them as
    // written (teaching order, aligned comments, explicit forms) instead of
    // letting the linter reformat them.
    files: ['**/*.md/**'],
    rules: {
      'style/no-multi-spaces': 'off',
      'perfectionist/sort-imports': 'off',
      'import/order': 'off',
      'import/consistent-type-specifier-style': 'off',
      'object-shorthand': 'off',
      'antfu/no-top-level-await': 'off',
      'unused-imports/no-unused-vars': 'off',
      'no-unused-vars': 'off',
    },
  },
  {
    // Our maintainer scripts log progress and touch the global `process`.
    files: ['scripts/**'],
    rules: {
      'no-console': 'off',
      'node/prefer-global/process': 'off',
    },
  },
)
