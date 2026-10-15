/**
 * `streak-forge/runtime` — the client authoring API, and nothing else: what
 * a widget / handler / component bundle needs while it renders (jsx
 * helpers like Script / Dynamic / the placeholders, the HOCs, JSON-safety).
 *
 * Widget source imports these from "streak-forge"; the prebuild points each
 * bundle at this entry instead (js-bundle.ts), so rendering a prebuilt
 * bundle — e.g. in the stage-1 container — never loads the main entry's
 * build tooling (TypeScript, chokidar, purgecss).
 */
export * from "./jsx";
export * from "./hoc";
export * from "./json-safe";
