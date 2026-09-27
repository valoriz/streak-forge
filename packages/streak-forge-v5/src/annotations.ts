import ts from "typescript";
import { readFileSync } from "node:fs";
import type { WidgetMeta, HandlerMeta, ComponentMeta, ShellMeta } from "./types.js";
import { hashOf } from "./hash.js";

/**
 * Annotation syntax: the `widget(meta)(fn)` / `handler(meta)(fn)` /
 * `component(meta)(fn)` HOC call shape (see hoc.ts) — real decorator syntax
 * (`@widget`) only attaches to class declarations/members in JS/TS, and
 * widgets/handlers/components here stay plain functions, so a call sitting
 * directly above the function is what gives the same "annotation right
 * above the function" ergonomics:
 *
 *   export const HelloBanner = widget({
 *     handler: "HelloBannerHandler",
 *     dynamicClasses: [["bg-red-500", "bg-blue-500"]],
 *   })((props: Props) => { ... });
 *
 *   export const getHelloBannerData = handler({ scope: "widget" })(
 *     async (...) => { ... },
 *   );
 *
 *   export const Button = component({
 *     dynamicClasses: [["bg-red-500", "bg-blue-500"]],
 *   })((props: Props) => { ... });
 *
 * `widget`/`handler`/`component` are ambient globals (globals.ts) — files
 * never import them. This module never executes any of that code, though:
 * it only statically matches the call shape via the TS AST
 * (`ts.createSourceFile`), same as the annotation tags this replaced.
 * Matching real nested array/object literals via AST (not regex) is what
 * lets `dynamicClasses` be a genuine nested array literal instead of a JSON
 * string embedded in a comment — regex breaks on nested brackets/strings,
 * the AST doesn't.
 *
 * IMPORTANT: this is a *label*, not a sandbox. See sandbox.ts for the
 * enforcement layer — annotations here only drive build-time codegen
 * (registry, CSS purge, cache keys), never runtime permissions.
 */

interface WidgetHocCall {
  kind: "widget";
  handlerName?: string;
  dynamicClassGroups: string[][];
}

interface HandlerHocCall {
  kind: "handler";
  scope?: "widget" | "common" | "middleware";
}

interface ComponentHocCall {
  kind: "component";
  dynamicClassGroups: string[][];
}

interface ShellHocCall {
  kind: "html" | "head" | "body" | "rootLayout";
  dynamicClassGroups: string[][];
}

export function parseFile(filePath: string): {
  widgets: WidgetMeta[];
  handlers: HandlerMeta[];
  components: ComponentMeta[];
  html: ShellMeta[];
  head: ShellMeta[];
  body: ShellMeta[];
  rootLayout: ShellMeta[];
} {
  const sourceText = readFileSync(filePath, "utf-8");
  const sourceFile = ts.createSourceFile(filePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  const widgets: WidgetMeta[] = [];
  const handlers: HandlerMeta[] = [];
  const components: ComponentMeta[] = [];
  const html: ShellMeta[] = [];
  const head: ShellMeta[] = [];
  const body: ShellMeta[] = [];
  const rootLayout: ShellMeta[] = [];

  const visit = (node: ts.Node) => {
    if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      const decl = node.declarationList.declarations[0];
      const exportName = decl?.name.getText(sourceFile) ?? "default";
      const call = matchHocCall(decl?.initializer, filePath);
      const nodeText = node.getText(sourceFile);

      if (call?.kind === "widget") {
        const type = inferWidgetTypeFromFilePath(filePath);
        const flat = call.dynamicClassGroups.flat();
        widgets.push({
          exportName,
          filePath,
          type,
          kind: call.handlerName ? "handler" : "static",
          handlerName: call.handlerName,
          dynamicClasses: flat,
          dynamicClassGroups: call.dynamicClassGroups,
          sourceHash: hashOf(nodeText + JSON.stringify(flat)),
        });
      }

      if (call?.kind === "handler") {
        handlers.push({
          exportName,
          filePath,
          scope: call.scope ?? "widget",
        });
      }

      if (call?.kind === "component") {
        const type = inferWidgetTypeFromFilePath(filePath);
        const flat = call.dynamicClassGroups.flat();
        components.push({
          exportName,
          filePath,
          type,
          dynamicClasses: flat,
          dynamicClassGroups: call.dynamicClassGroups,
          sourceHash: hashOf(nodeText + JSON.stringify(flat)),
        });
      }

      if (call?.kind === "html" || call?.kind === "head" || call?.kind === "body" || call?.kind === "rootLayout") {
        const type = inferWidgetTypeFromFilePath(filePath);
        const flat = call.dynamicClassGroups.flat();
        const entry: ShellMeta = {
          exportName,
          filePath,
          type,
          dynamicClasses: flat,
          dynamicClassGroups: call.dynamicClassGroups,
          sourceHash: hashOf(nodeText + JSON.stringify(flat)),
        };
        const target =
          call.kind === "html" ? html : call.kind === "head" ? head : call.kind === "body" ? body : rootLayout;
        target.push(entry);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return { widgets, handlers, components, html, head, body, rootLayout };
}

function hasExportModifier(node: ts.VariableStatement): boolean {
  return (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function inferWidgetTypeFromFilePath(filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  return base.replace(/\.(tsx|ts|jsx|js)$/, "");
}

const SHELL_HOC_NAMES = new Set(["html", "head", "body", "rootLayout"]);

/**
 * Matches `widget(meta)(fn)` / `handler(meta)(fn)` / `component(meta)(fn)`
 * / `html(meta)(fn)` / `head(meta)(fn)` / `body(meta)(fn)` /
 * `rootLayout(meta)(fn)` — an outer call whose callee is itself a call to
 * one of those identifiers. Returns null for anything else (a plain
 * function, a differently-shaped call), same as "no JSDoc tags found" did
 * before.
 */
function matchHocCall(
  expr: ts.Expression | undefined,
  filePath: string,
): WidgetHocCall | HandlerHocCall | ComponentHocCall | ShellHocCall | null {
  if (!expr || !ts.isCallExpression(expr)) return null;
  const outer = expr.expression;
  if (!ts.isCallExpression(outer) || !ts.isIdentifier(outer.expression)) return null;

  const name = outer.expression.text;
  const isKnown = name === "widget" || name === "handler" || name === "component" || SHELL_HOC_NAMES.has(name);
  if (!isKnown) return null;
  if (expr.arguments.length === 0) return null; // widget(meta) with no wrapped fn — not a real call site

  const metaArg = outer.arguments[0];
  const meta = metaArg && ts.isObjectLiteralExpression(metaArg) ? metaArg : undefined;

  if (name === "widget") {
    return {
      kind: "widget",
      handlerName: readStringProp(meta, "handler"),
      dynamicClassGroups: readStringArrayArrayProp(meta, "dynamicClasses", filePath) ?? [],
    };
  }
  if (name === "component") {
    return {
      kind: "component",
      dynamicClassGroups: readStringArrayArrayProp(meta, "dynamicClasses", filePath) ?? [],
    };
  }
  if (SHELL_HOC_NAMES.has(name)) {
    return {
      kind: name as "html" | "head" | "body" | "rootLayout",
      dynamicClassGroups: readStringArrayArrayProp(meta, "dynamicClasses", filePath) ?? [],
    };
  }
  return { kind: "handler", scope: readScopeProp(meta) };
}

function findProp(obj: ts.ObjectLiteralExpression | undefined, key: string): ts.Expression | undefined {
  if (!obj) return undefined;
  const prop = obj.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === key);
  return prop?.initializer;
}

function readStringProp(obj: ts.ObjectLiteralExpression | undefined, key: string): string | undefined {
  const init = findProp(obj, key);
  return init && ts.isStringLiteralLike(init) ? init.text : undefined;
}

function readScopeProp(obj: ts.ObjectLiteralExpression | undefined): "widget" | "common" | "middleware" | undefined {
  const value = readStringProp(obj, "scope");
  return value === "widget" || value === "common" || value === "middleware" ? value : undefined;
}

function readStringArrayArrayProp(
  obj: ts.ObjectLiteralExpression | undefined,
  key: string,
  filePath: string,
): string[][] | undefined {
  const init = findProp(obj, key);
  if (!init) return undefined;
  if (!ts.isArrayLiteralExpression(init)) {
    throw new Error(`${filePath}: "${key}" must be an array of string arrays, e.g. ${key}: [["bg-red-500","bg-blue-500"]]`);
  }
  return init.elements.map((group) => {
    if (!ts.isArrayLiteralExpression(group)) {
      throw new Error(`${filePath}: "${key}" must be an array of string arrays, e.g. ${key}: [["bg-red-500","bg-blue-500"]]`);
    }
    return group.elements.map((el) => {
      if (!ts.isStringLiteralLike(el)) {
        throw new Error(`${filePath}: "${key}" entries must be string literals`);
      }
      return el.text;
    });
  });
}
