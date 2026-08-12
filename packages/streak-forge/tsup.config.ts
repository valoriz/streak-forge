import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    // Match the same public entry as your JS build
    "src/components/index": "src/components/index.tsx",
    "src/index": "src/index.ts",
  },
  dts: {
    resolve: true,
  },

  skipJs: true, // ⬅️ CRITICAL: never emit JS
  clean: false, // ⬅️ CRITICAL: never delete Bun-built JS
  outDir: "dist",
  shims: true, // ensures __dirname works
});
