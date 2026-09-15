import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      'apps/web/.next*/**',
      'apps/api/prisma/migrations/**',
      'output/**',
      'storage/**',
      '.claude/**',
      '**/.claude/**',
      '.playwright-cli/**',
      '**/.playwright-cli/**',
      'scripts/*-browser-check.js',
      'scripts/*-live-check.js',
      'scripts/upload-feedback-check.js',
      'apps/web/next-env.d.ts'
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The base rule double-reports on TypeScript syntax; the TS version
      // understands type-only imports and parameter properties.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrors: 'none'
      }],
      // Dead-code detectors. These are the rules that would have caught the
      // unreachable branches and no-op expressions found during review.
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-constant-binary-expression': 'error',
      'no-unreachable': 'error',
      'no-dupe-else-if': 'error',
      'no-self-compare': 'error',
      'no-unneeded-ternary': 'error',
      'require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'warn'
    }
  },
  {
    // Node entrypoints, workers, tooling scripts.
    files: ['apps/api/**/*.ts', 'packages/**/*.ts', 'scripts/**/*.{js,mjs}', 'apps/api/scripts/**/*.mjs', '*.mjs'],
    languageOptions: {
      globals: { ...globals.node }
    }
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } }
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Existing UI code intentionally synchronizes query state and DOM
      // refs in effects; keep lint focused on correctness rules for now.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/preserve-manual-memoization': 'off'
    }
  },
  {
    files: ['apps/web/**/*.js'],
    languageOptions: { globals: { ...globals.node } }
  },
  {
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.node }
    }
  }
);
