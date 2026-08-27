import { watch } from "fs";
import { build } from "./build.ts";

const DIST_DIR = "dist";

// Initial build
await build();

// Debounced rebuild to avoid rapid successive rebuilds
let timer: ReturnType<typeof setTimeout> | null = null;
const rebuild = () => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => {
    console.log("[dev] Change detected, rebuilding...");
    await build();
  }, 100);
};

watch("docs", { recursive: true }, rebuild);
watch("templates", { recursive: true }, rebuild);

// Dev server
const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url);
    let filePath = `${DIST_DIR}${url.pathname}`;
    if (filePath.endsWith("/")) filePath += "index.html";
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },
});

console.log("[dev] Server running:", server.url);
console.log("[dev] Watching docs/ and templates/ for changes...");
