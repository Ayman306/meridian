import next from 'eslint-config-next'

/**
 * eslint-config-next ships a flat config, so it is composed directly rather
 * than through the eslintrc compatibility layer.
 */
export default [
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'node_modules/**',
      // Generated from the migrations by `supabase gen types typescript`.
      'src/types/database.ts',
    ],
  },
  ...next,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      // Underscore-prefixed args are a deliberate "unused on purpose" marker.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
]
