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
      '**/__archive__/**',
      '**/__references__/**',
      '**/__temp__/**',
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
    // Maintainer scripts and runnable demos log progress, use top-level await,
    // and touch the global `process` — all intentional there.
    files: ['scripts/**', 'sandbox/**'],
    rules: {
      'no-console': 'off',
      'node/prefer-global/process': 'off',
      'antfu/no-top-level-await': 'off',
    },
  },
)
