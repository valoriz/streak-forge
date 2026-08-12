import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";

export default defineConfig([
  {
    files: ["src/**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"], // 👈 only lint inside src
    ignores: [
      "src/template/**", // ignore template folder
      "dist/**",         // ignore build output
      "node_modules/**", // ignore dependencies
    ],
    plugins: { js },
    extends: ["js/recommended"],
    languageOptions: {
      globals: globals.browser,
    }
  },
  ...tseslint.configs.recommended, // spread recommended TS rules
]);
