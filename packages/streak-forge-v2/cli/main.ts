#!/usr/bin/env bun
import { registerScriptTransform } from "../src/build/scriptTransform";
import { startDevServer } from "../src/devServer";
import { startWatcher } from "../src/watcher";

const command = process.argv[2];

switch (command) {
  case "dev": {
    registerScriptTransform();
    await startDevServer();
    startWatcher();
    break;
  }
  default:
    console.info(
      `streak v2 - stage 1 (dev server only). Unknown command: ${command ?? ""}`,
    );
    console.info("Usage: streak dev");
    process.exit(1);
}
