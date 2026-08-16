import { readFileSync } from "fs";
import ts from "typescript";
import { KNOWN_GLOBALS } from "./knownGlobals";

const SCRIPT_TAG = "Script";

/** Transpiles one extracted arrow/function-expression's source to plain JS (types stripped). */
const transpileFnToJs = (fnSource: string): string => {
  const wrapped = `export default ${fnSource}`;
  const output = ts.transpileModule(wrapped, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.None,
      removeComments: false,
    },
  }).outputText;
  return output
    .replace(/^export default\s+/, "")
    .trim()
    .replace(/;\s*$/, "");
};

const collectBindingNames = (name: ts.BindingName, out: Set<string>): void => {
  if (ts.isIdentifier(name)) {
    out.add(name.text);
    return;
  }
  for (const el of name.elements) {
    if (ts.isBindingElement(el)) collectBindingNames(el.name, out);
  }
};

/** Every name a <Script> body declares itself (locals, params, destructured bindings, nested fns). */
const collectDeclaredNames = (root: ts.Node): Set<string> => {
  const declared = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) {
      collectBindingNames(node.name, declared);
    } else if (
      (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node)) &&
      node.name
    ) {
      declared.add(node.name.text);
    } else if (ts.isCatchClause(node) && node.variableDeclaration) {
      collectBindingNames(node.variableDeclaration.name, declared);
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(root, visit);
  return declared;
};

/** Identifiers *read* inside a <Script> body that aren't declared inside it - candidate closures. */
const collectFreeIdentifiers = (root: ts.Node, declared: Set<string>): Map<string, number> => {
  const free = new Map<string, number>();

  const record = (id: ts.Identifier): void => {
    if (!declared.has(id.text) && !free.has(id.text)) free.set(id.text, id.getStart());
  };

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isPropertyAssignment(node)) {
      if (node.name && ts.isComputedPropertyName(node.name)) visit(node.name.expression);
      visit(node.initializer);
      return;
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      record(node.name);
      return;
    }
    if (ts.isVariableDeclaration(node) || ts.isBindingElement(node)) {
      if (node.initializer) visit(node.initializer);
      return;
    }
    if (ts.isParameter(node)) {
      if (node.initializer) visit(node.initializer);
      return;
    }
    if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)) {
      node.parameters.forEach(visit);
      if (node.body) visit(node.body);
      return;
    }
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      visit(node.expression);
      return;
    }
    if (ts.isIdentifier(node)) {
      record(node);
      return;
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(root, visit);
  return free;
};

export interface ClosureLeak {
  name: string;
  file: string;
  line: number;
  column: number;
}

/** Heuristic, not a full scope resolver - collects candidate closure-leak references, doesn't judge them. */
const findClosureLeaksInFn = (fn: ts.ArrowFunction | ts.FunctionExpression, sourceFile: ts.SourceFile, filePath: string): ClosureLeak[] => {
  const declared = collectDeclaredNames(fn);
  const free = collectFreeIdentifiers(fn, declared);
  const leaks: ClosureLeak[] = [];

  for (const [name, pos] of free) {
    if (KNOWN_GLOBALS.has(name)) continue;
    const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);
    leaks.push({ name, file: filePath, line: line + 1, column: character + 1 });
  }

  return leaks;
};

const ESC = String.fromCharCode(27);
const ANSI_RED = ESC + "[31m";
const ANSI_BOLD = ESC + "[1m";
const ANSI_RESET = ESC + "[0m";

export const formatClosureLeak = (leak: ClosureLeak, colored = false): string => {
  const message =
    `streak: <Script> in ${leak.file}:${leak.line}:${leak.column} references "${leak.name}", which is not a browser global, ` +
    `"gDom", or "options". Closures over outer/imported values are dropped during serialization - ` +
    `pass "${leak.name}" via the Script's options prop instead.`;
  return colored ? ANSI_BOLD + ANSI_RED + message + ANSI_RESET : message;
};

type ClosureLeakListener = (leak: ClosureLeak) => void;
const listeners: ClosureLeakListener[] = [];

/** Lets devServer.ts push detected leaks to connected browsers without this module depending on it. */
export const onClosureLeak = (fn: ClosureLeakListener): void => {
  listeners.push(fn);
};

const notifyClosureLeak = (leak: ClosureLeak): void => listeners.forEach((fn) => fn(leak));

/** Every <Script> body's closure leaks in one file - used by `streak validate` (throws there, warns in dev). */
export const findClosureLeaks = (source: string, filePath: string): ClosureLeak[] => {
  const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const leaks: ClosureLeak[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName;
      if (ts.isIdentifier(tag) && tag.text === SCRIPT_TAG) {
        for (const child of node.children) {
          if (ts.isJsxExpression(child) && child.expression) {
            const expr = child.expression;
            if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
              leaks.push(...findClosureLeaksInFn(expr, sourceFile, filePath));
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return leaks;
};

const transformSource = (source: string, filePath: string): string => {
  const scriptKind = filePath.endsWith(".tsx") || filePath.endsWith(".jsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const replacements: Array<{ start: number; end: number; text: string }> = [];

  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName;

      if (ts.isIdentifier(tag) && tag.text === SCRIPT_TAG) {
        for (const child of node.children) {
          if (ts.isJsxExpression(child) && child.expression) {
            const expr = child.expression;

            if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
              findClosureLeaksInFn(expr, sourceFile, filePath).forEach((leak) => {
                console.warn(formatClosureLeak(leak, true));
                notifyClosureLeak(leak);
              });

              const fnSource = source.slice(expr.getStart(sourceFile), expr.getEnd());
              const jsSource = transpileFnToJs(fnSource);

              // Bake the function source in as a plain string. The `options`
              // value is only known at render time (often derived from
              // request/handler data), so the Script component still does
              // the `(fnSource)(window, options)` wrap itself - this only
              // removes the runtime `Function.prototype.toString()` step.
              replacements.push({
                start: child.getStart(sourceFile),
                end: child.getEnd(),
                text: `{${JSON.stringify(jsSource)}}`,
              });
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  if (replacements.length === 0) return source;

  let result = source;
  for (const rep of replacements.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, rep.start) + rep.text + result.slice(rep.end);
  }
  return result;
};

// Bun's onLoad, given plugin-supplied *.tsx/*.jsx `contents` + `loader:"tsx"`,
// only reliably re-parses the JSX inside a Bun.serve() request handler - the
// identical plugin+content fails to parse as JSX at all when the same import
// happens in a plain top-level script (confirmed with a minimal 10-line
// repro with none of this project's code involved - a genuine Bun quirk, not
// something fixable by changing what we return). So instead of leaning on
// Bun's own JSX pass for plugin content, we compile JSX to plain JS
// ourselves via the TS compiler and hand Bun only "js" - Bun's JSX pipeline
// is then never in the loop for plugin-supplied content, in any context.
// Also covers plain .ts/.js: the same onLoad-vs-native-parse divergence shows
// up there too (confirmed - a plain `import type {...}` statement, valid
// TS, fails to re-parse with "Expected 'from' but found '{'" when handed
// back via onLoad with an explicit `loader:"ts"` during a build/CLI run,
// despite parsing fine as a native, non-plugin-mediated import). Running
// every matched file through the compiler ourselves and always handing Bun
// plain "js" sidesteps Bun's onLoad re-parse entirely, for every extension.
const compileToJs = (source: string, filePath: string): string => {
  return ts.transpileModule(source, {
    fileName: filePath,
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "streak-forge",
      esModuleInterop: true,
    },
  }).outputText;
};

/**
 * Shared by both the dev server (registered globally via Bun.plugin, so it
 * applies to every dynamic import) and `pre-build` (passed explicitly to
 * Bun.build({plugins:[...]}) for its one-shot bundling pass).
 */
export const scriptTransformPlugin: Bun.BunPlugin = {
  name: "streak-script-transform",
  // Must be async: Bun.plugin()'s return type is ReturnType<setup>, and a
  // sync setup returns nothing to await. Bun's own docs warn that plugin
  // registration "may be initialized after a module is resolved" - without
  // a Promise to await here, a dynamic import() fired immediately after
  // Bun.plugin() can race the registration and silently skip this transform.
  async setup(build) {
    // moduleLoader.ts busts the dev-server module cache by appending
    // `?v=<timestamp>` to re-imported specifiers on file change - without
    // the trailing `(\?.*)?` here, that suffix stops this filter from
    // matching, so every re-import after the first silently skips this
    // transform (and the closure-leak check) and falls through to Bun's
    // default loader instead.
    build.onLoad({ filter: /\.(tsx|jsx|ts|js)(\?.*)?$/ }, (args) => {
      const filePath = args.path.split("?")[0]!;
      const source = readFileSync(filePath, "utf-8");

      // Bun requires an object back once a file matches the filter (unlike
      // esbuild, where returning undefined here falls through to the
      // default loader) - so untouched files still get handled the same way.
      // Always "js": every matched file goes through compileToJs regardless
      // of extension (see its comment for why), so there's never TS/JSX
      // syntax left for Bun's own loader to re-parse.
      if (!source.includes(`<${SCRIPT_TAG}`)) {
        return { contents: compileToJs(source, filePath), loader: "js" };
      }

      const transformed = transformSource(source, filePath);
      return { contents: compileToJs(transformed, filePath), loader: "js" };
    });
  },
};

let registered = false;

/** Registers the onLoad transform once per process. Callers must await this before importing any widget/layout. */
export const registerScriptTransform = async (): Promise<void> => {
  if (registered) return;
  registered = true;
  await Bun.plugin(scriptTransformPlugin);
};
