import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Inline rule suppressions (eslint-disable comments) are allowed only with a
 * preceding justification comment (constitution IV). Formatting is owned by
 * Prettier; these rules complement it, never fight it.
 */
export default tseslint.config(
    {
        ignores: [
            'dist/**',
            'node_modules/**',
            'pnpm-lock.yaml',
            'context/**',
            'specs/**',
            '.specify/**',
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
        },
    },
    prettier
);
