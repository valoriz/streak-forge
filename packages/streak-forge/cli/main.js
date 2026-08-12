#!/usr/bin/env bun

import chokidar from "chokidar";
import path from "path";

const args = process.argv.slice(2);
const command = args[0];
const projectRoot = process.cwd();

let currentServer = null;
let broadcastReload = null;

let debounceTimeout;
let isReloading = false;

async function beforeStartServer() {
  console.info("🚀 Starting server...");

  // Invalidate ALL modules (full reload)
  for (const key of Object.keys(require.cache || {})) {
    delete require.cache[key];
  }

  const mod = await import(`../src/server?cacheBust=${Date.now()}`);
  if (mod.doBeforeServerStart) {
    await mod.doBeforeServerStart();
  }
}

async function startServer() {
  console.info("🚀 Starting server...");

  // Invalidate ALL modules (full reload)
  for (const key of Object.keys(require.cache || {})) {
    delete require.cache[key];
  }

  const mod = await import(`../src/server?cacheBust=${Date.now()}`);
  if (mod.broadcastReload) broadcastReload = mod.broadcastReload;
  if (mod.default) currentServer = await mod.default();
}

async function stopServer() {
  if (broadcastReload) {
    broadcastReload();
    broadcastReload = null;
  }
  if (currentServer && typeof currentServer.stop === "function") {
    console.info("🛑 Stopping server...");
    await currentServer.stop(true);
    currentServer = null;
  }
}

async function devMode() {
  console.info("👀 Watching for changes in /...");

  await beforeStartServer();
  await startServer();

  const srcDir = path.join(projectRoot, "./");

  const userIgnorePatterns = (process.env.STREAK_WATCH_IGNORE || "")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const isUserIgnored = (filePath) =>
    userIgnorePatterns.some((p) => filePath.includes(p));

  const watcher = chokidar.watch(srcDir, {
    ignored: (filePath) =>
      /(node_modules|dist|\.git|\.streak|\.cache|\.prebuild)(\/|\\|$)/.test(filePath) || isUserIgnored(filePath),
    ignoreInitial: true,
    persistent: true,
    usePolling: false,
    awaitWriteFinish: {
      stabilityThreshold: 300,
      pollInterval: 100,
    },
  });

  const handleChange = async (filePath) => {
    const rel = path.relative(srcDir, filePath);

    if (!/\.(ts|tsx|js|jsx|json|html|env)$/.test(rel)) return;

    console.info(`🔄 Change detected: ${rel}, server reloads in 500ms...`);

    if (debounceTimeout) clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(async () => {
      if (isReloading) return;
      isReloading = true;
      try {
        if (/public/.test(rel)) {
          await beforeStartServer();
        }
        await stopServer();
        await startServer();
      } catch (err) {
        console.error("❌ Error reloading server:", err);
      } finally {
        isReloading = false;
      }
    }, 500);
  };

  watcher.on("change", handleChange).on("add", handleChange).on("error", (err) => {
    console.error("❌ Watcher error:", err);
  });
}

switch (command) {
  case "dev":
    await devMode();
    break;

  case "dev-build":
    await import("../src/dev-build");
    break;

  case "build":
    await import("../src/app");
    break;

  case "pre-build":
    await import("../src/pre-build");
    break;

  default:
    console.info(`Unknown command: ${command}`);
    console.info("Usage: streak-forge <dev|dev-build|build|pre-build>");
    process.exit(1);
}
