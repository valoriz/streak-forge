// eslint.config.js
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import prettierPlugin from "eslint-plugin-prettier";
import unusedImports from "eslint-plugin-unused-imports";

export default [
  //
  // GLOBAL IGNORE PATTERNS
  //
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/public/assets/**/*.js"],
  },

  //
  // BASE JS + TS RULESETS
  //
  js.configs.recommended,
  ...tseslint.configs.recommended,

  //
  // MAIN RULES APPLICABLE TO ALL PACKAGES/LIBS
  //
  {
    files: ["**/packages/**/*.{ts,tsx,js}", "**/core/**/*.{ts,tsx,js}"],

    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        // IMPORTANT for monorepos:
        // Each project has its own tsconfig.json, so this lets ESLint auto-locate it.
        projectService: true,
        tsconfigRootDir: import.meta.dirname, // root of monorepo
        sourceType: "module",
      },
    },

    plugins: {
      import: importPlugin,
      prettier: prettierPlugin,
      "unused-imports": unusedImports,
    },

    settings: {
      "import/resolver": {
        typescript: {
          project: ["packages/*/tsconfig.json", "apps/*/tsconfig.json"],
          noWarnOnMultipleProjects: true,
        },
      },
    },

    rules: {
      "prettier/prettier": "error",

      // Turn off base unused vars rules for TS
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": "off",

      // Use unused-imports plugin instead
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "warn",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],

      "import/prefer-default-export": "off",

      "import/extensions": [
        "error",
        "ignorePackages",
        {
          ts: "never",
          tsx: "never",
          js: "never",
        },
      ],

      "no-console": ["warn", { allow: ["info", "warn", "error"] }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unsafe-function-type": "warn",
    },
  },

  //
  // WORKER FILE RULES
  //
  {
    files: ["**/*worker.ts", "**/*worker.js", "**/assetWorker.*", "**/public/**/*.js"],

    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        self: true,
        fetch: true,
        postMessage: true,
        addEventListener: true,
        removeEventListener: true,
      },
    },

    rules: {
      "no-undef": "off",
    },
  },
];
