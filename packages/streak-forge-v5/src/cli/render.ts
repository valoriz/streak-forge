import { statSync } from "node:fs";
import { renderToString, Dynamic, type VNodeChild, type DynamicProps } from "../jsx.js";

/** Dynamically imports a widget/component/html/head/body/rootLayout's own
 *  module and calls its exported function with `props`. Every entry in a
 *  consuming project follows the streak-forge convention of
 *  `props?.data?.field ?? default`, never `props.data.field`, so calling
 *  with arbitrary (including empty) props is always safe.
 *
 *  The `?v=<mtime>` query busts Bun/Node's ES module cache, which keys on
 *  the resolved specifier string — a one-shot `prebuild`/`build` process
 *  never notices (fresh process, fresh cache, every time), but a
 *  long-running process that imports the SAME file more than once (`dev`,
 *  re-importing on every file-change rebuild) would otherwise get the
 *  FIRST-loaded module back forever, silently ignoring every edit. */
async function importAndCall(entry: { filePath: string; exportName: string }, props: Record<string, unknown>): Promise<unknown> {
  const version = statSync(entry.filePath).mtimeMs;
  const mod = (await import(`${entry.filePath}?v=${version}`)) as Record<string, (props: unknown) => unknown>;
  const fn = mod[entry.exportName];
  if (!fn) throw new Error(`${entry.filePath}: no export named "${entry.exportName}"`);
  return fn(props);
}

function isVNodeChild(value: unknown): value is VNodeChild {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    Array.isArray(value) ||
    (typeof value === "object" && value !== undefined && "type" in (value as object))
  );
}

/**
 * `renderToString` treats an unresolved `<Dynamic>` as empty — correct for
 * the real build/request path, where page-build.ts's extractDynamicBlocks
 * already stripped every Dynamic node out before renderToString ever runs
 * (see jsx.ts's Dynamic doc comment). The CSS-purge sample scan below
 * never goes through that extraction step, so left alone it would miss
 * every class used ONLY inside a Dynamic block, silently purging them —
 * this unwraps Dynamic to its real children instead (in place, no
 * persistence — this is scanning for classes that exist in the file at
 * all, not composing a real page), so the sample scan sees the exact same
 * markup a real build would extract into that block's own fragment.
 */
function expandDynamicForSample(node: VNodeChild): VNodeChild {
  if (node === null || node === undefined || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expandDynamicForSample);
  if (node.type === Dynamic) {
    const { children } = node.props as unknown as DynamicProps;
    return expandDynamicForSample(children ?? null);
  }
  const children = node.props?.children as VNodeChild;
  if (children === undefined) return node;
  return { type: node.type, props: { ...node.props, children: expandDynamicForSample(children) } };
}

/**
 * Real rendered HTML for the CSS-purge scan, not a placeholder — calls with
 * `{}` since real per-instance props don't matter for that (CSS output is
 * data-independent by design, see the dynamicClasses rule).
 *
 * `head()` returns real JSX (title/meta/link) — renderToString it like any
 * widget. `html()`/`body()` return plain attribute objects instead (there's
 * only ever one <html>/<body> tag, nothing to "render a sample of" the way
 * a widget's markup works) — nothing to scan beyond their own
 * dynamicClasses, which streak-forge's dummy-element injection already
 * covers, so those just contribute no extra sample markup.
 */
export async function renderSample(entry: { filePath: string; exportName: string }): Promise<string> {
  const result = await importAndCall(entry, {});
  return isVNodeChild(result) ? renderToString(expandDynamicForSample(result)) : "";
}

/**
 * `page-build.ts`'s `RenderInstance` contract — same import-and-call as
 * renderSample, but with REAL props (a widget instance's actual sitemap
 * data, not `{}`), and returning the RAW result completely unfiltered —
 * unlike renderSample, this doesn't coerce anything to a VNodeChild.
 * page-build.ts calls this for two structurally different kinds of entry:
 * a widget/rootLayout/head (real VNodeChild, gets renderToString'd) and an
 * html()/body() (a plain attribute object like `{ lang: "en" }`, gets
 * passed to renderAttrs instead) — filtering here the way renderSample
 * does would silently turn every html()/body() call into `null`, dropping
 * real attribute data. page-build.ts knows which case it's in from which
 * registry category it looked the meta up in, so it does the interpreting.
 */
export async function renderInstance(
  entry: { filePath: string; exportName: string },
  props: Record<string, unknown>,
): Promise<unknown> {
  return importAndCall(entry, props);
}

// renderInstanceFromBundle (imports a PREBUILT bundle instead of raw .tsx
// source, for an isolated build job with no project source tree) lives
// only in the streak-boot package (streakjs repo) — it's the one thing
// on this file's original surface this package genuinely never needs:
// `dev`/`prebuild` always run inside the real project, source tree
// present, by definition.
