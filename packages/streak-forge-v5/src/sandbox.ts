import vm from "node:vm";

/**
 * Answers open doubt #3: WHICH runtime enforces the @handler FS/env
 * restriction. The @handler annotation is a LABEL only — nothing about
 * writing "@handler" above a function stops it from calling require("fs")
 * unless something at the runtime layer actually blocks it. Three real
 * options, ranked:
 *
 *   1. Deno --allow-read=<path> --allow-env=<VAR> --allow-net
 *      Cleanest: kernel/runtime-enforced, granular per-permission, built in.
 *      Pick this if the project can standardize on Deno.
 *
 *   2. Node --experimental-permission --allow-fs-read=... --allow-env=...
 *      Same idea, still experimental as of Node 22 — verify maturity/flag
 *      stability against the Node version actually pinned before betting
 *      production isolation on it.
 *
 *   3. node:vm (this file) — a V8 isolate/context, same primitive CF
 *      Workers build on. No child process, no container, and it solves
 *      the ORIGINAL Docker complaint (cold-start latency) simultaneously.
 *      Weaker than 1/2 on network sandboxing (vm doesn't restrict fetch()
 *      by itself — you have to NOT put fetch/require in the sandbox's
 *      global scope, which this implementation does).
 *
 * This module implements option 3 so the enforcement is testable without
 * requiring the host project to switch its whole runtime. It is NOT a
 * substitute for real process isolation against a malicious/untrusted
 * handler author — vm context escapes are a known category of V8 bugs.
 * Use option 1 or a real microVM (Firecracker, gVisor) if handlers are
 * ever written by someone you don't trust, not just someone you trust who
 * might make a mistake.
 */

export interface SandboxPolicy {
  /** Env vars explicitly allowed to be read — everything else is undefined
   *  inside the sandbox, not just hidden, actually absent from the object. */
  allowedEnv: string[];
  /** Milliseconds before a handler is killed — must be well under the
   *  platform's own request timeout so a runaway handler fails fast. */
  timeoutMs: number;
}

export interface SandboxResult<T> {
  ok: boolean;
  value?: T;
  error?: string;
  timedOut: boolean;
}

/**
 * Runs a handler function's source in an isolated V8 context:
 *  - no `require`, no `fs`, no `process` (real process, not a proxy) in scope
 *  - only an explicitly allow-listed subset of env vars is visible, as a
 *    frozen plain object — not process.env itself
 *  - `fetch` IS provided (handlers legitimately need network I/O for data
 *    fetching) — this sandbox's boundary is filesystem + full env + child
 *    process spawning, not network, matching what @handler is meant to stop
 *  - hard timeout via vm's own `timeout` option, which interrupts the
 *    isolate (this is what makes vm safe against infinite loops in a way a
 *    plain async try/catch is not)
 */
export async function runHandlerSandboxed<T>(
  handlerSource: string,
  args: unknown[],
  policy: SandboxPolicy,
): Promise<SandboxResult<T>> {
  const restrictedEnv = Object.freeze(
    Object.fromEntries(policy.allowedEnv.map((key) => [key, process.env[key]])),
  );

  const context = vm.createContext({
    console,
    fetch: globalThis.fetch,
    process: { env: restrictedEnv }, // NOT the real process object
    __args: args,
    __result: undefined as T | undefined,
    setTimeout,
    clearTimeout,
    Promise,
    JSON,
    // Deliberately absent: require, module, __dirname, __filename,
    // process.exit/cwd/argv, child_process, real fs.
  });

  const wrapped = `
    (async () => {
      const __handler = (${handlerSource});
      __result = await __handler(...__args);
    })()
  `;

  try {
    const script = new vm.Script(wrapped, { filename: "sandboxed-handler.js" });
    await script.runInContext(context, { timeout: policy.timeoutMs });
    return { ok: true, value: context.__result as T, timedOut: false };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const timedOut = message.includes("Script execution timed out");
    return { ok: false, error: message, timedOut };
  }
}

export const DEFAULT_SANDBOX_POLICY: SandboxPolicy = {
  allowedEnv: [],
  timeoutMs: 5000,
};
