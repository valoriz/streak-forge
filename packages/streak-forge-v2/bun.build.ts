import fs from "fs";

const isProduction = process.env.NODE_ENV === "production";

const result = await Bun.build({
  entrypoints: [
    "./cli/main.ts",
    "./src/components/index.tsx",
    "./src/jsx/jsx-runtime.ts",
    "./src/jsx/jsx-dev-runtime.ts",
  ],
  outdir: "./dist",
  target: "bun",
  minify: isProduction,
  sourcemap: isProduction ? "none" : "inline",
  // Real runtime deps of the consuming app, not something to inline - keeps
  // the shipped bundle small and lets normal semver/dedupe rules apply.
  external: ["typescript", "chokidar", "dotenv", "node-html-parser"],
  naming: {
    entry: "[dir]/[name].js",
  },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("streak-forge-v2 build failed");
}

for (const artifact of result.outputs) {
  console.info(`built: ${artifact.path}`);
}

// cli/main.ts needs a working shebang once bundled (Bun.build strips it).
const cliOut = "./dist/cli/main.js";
const cliContents = fs.readFileSync(cliOut, "utf-8");
if (!cliContents.startsWith("#!/usr/bin/env bun")) {
  fs.writeFileSync(cliOut, `#!/usr/bin/env bun\n${cliContents}`);
}
fs.chmodSync(cliOut, 0o755);
