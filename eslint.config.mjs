// @ts-check

// eslint.config.js
import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from 'typescript-eslint';

export default defineConfig([
    {
        ignores: ["**/dist/**", "**/coverage/**", "**/node_modules/**"],
    },
	{
		files: ["packages/**/*.js"],
		plugins: {
			js,
		},
		extends: ["js/recommended"]
	},
    {
        files: ["packages/**/*.ts", "packages/**/*.tsx"],
        languageOptions: {
            parser: tseslint.parser,
        },
        plugins: {
            tseslint,
        },
        extends: [
            "tseslint/recommended",
        ],
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            '@typescript-eslint/no-explicit-any': 'warn',
            'no-undef': 'off',
        },
    }
]);
