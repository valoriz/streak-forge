import { readFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

/**
 * Purge sample for one widget/component/shell WITHOUT running any of its
 * code: the raw source text of its file plus every project file it imports,
 * transitively. The purge engine extracts class-like tokens from that text
 * (same idea as Tailwind's own content scan), so a class written anywhere
 * in that source keeps its CSS.
 *
 * Nothing is imported or executed — no handler runs, no network call, no
 * runtime env needed — so `prebuild` works in CI with no secrets. The cost
 * is a slightly larger CSS file than a render would give: a token that
 * appears in the source but is never rendered (a comment, a branch no
 * page reaches) still keeps its rule.
 *
 * Imports are resolved with Bun's own resolver (relative paths and
 * tsconfig `paths` aliases alike). Only files inside `projectRoot` are
 * read — never node_modules, and never a package linked in from outside
 * the project (a `file:`/workspace symlink resolves to its real path).
 */
export function sourceSampleFor(
  projectRoot: string,
): (entry: { filePath: string }) => Promise<string> {
  const root = resolve(projectRoot) + sep;
  return (entry) => sourceSample(entry, root);
}

async function sourceSample(
  entry: { filePath: string },
  root: string,
): Promise<string> {
  const seen = new Set<string>();
  const queue = [entry.filePath];
  const texts: string[] = [];
  while (queue.length > 0) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let text: string;
    try {
      text = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    texts.push(text);
    for (const specifier of importSpecifiers(text)) {
      const resolved = resolveProjectFile(specifier, dirname(file), root);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  return texts.join("\n");
}

const IMPORT_PATTERNS = [
  /\b(?:import|export)\s[^'"`;]*?\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']/g,
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
];

function importSpecifiers(text: string): string[] {
  const out = new Set<string>();
  for (const pattern of IMPORT_PATTERNS) {
    for (const match of text.matchAll(pattern)) out.add(match[1]!);
  }
  return [...out];
}

function resolveProjectFile(
  specifier: string,
  fromDir: string,
  root: string,
): string | null {
  try {
    const resolved = Bun.resolveSync(specifier, fromDir);
    if (
      !resolved.startsWith(root) ||
      resolved.includes(`${sep}node_modules${sep}`)
    )
      return null;
    if (!/\.(tsx|ts|jsx|js|mjs)$/.test(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
}
