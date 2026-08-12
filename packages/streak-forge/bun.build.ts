import fs from "fs";
import path from "path";
import Bun from "bun";

const customEndPoints: string[] = [];

const buildDir = "./dist";

await Bun.build({
  entrypoints: ["./cli/main.js", "./src/index.ts", "./src/server.ts", "./src/components/index.tsx", ...customEndPoints],
  outdir: buildDir,
  target: "bun",
  external: ["tailwindcss", "postcss", "autoprefixer", "cssnano", "node-html-parser", "esbuild"],
  define: {
    __dirname: path.join(import.meta.dirname, buildDir),
    __filename: import.meta.filename,
  },
  minify: true,
  sourcemap: process.env.NODE_ENV === "development" ? "inline" : "none",
});

try {
  // copy the public directory to the build directory
  const publicDir = path.join(import.meta.dirname, "public");
  const buildPublicDir = path.join(import.meta.dirname, buildDir, "public");

  // add a folder exists check
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, buildPublicDir, {
      recursive: true,
      filter: (src) => {
        // Exclude the node_modules directory
        return !src.includes("node_modules");
      },
    });
  }
} catch (error) {
  console.warn(error);
}
