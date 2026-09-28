export {};

/**
 * Ambient types for the `widget`/`handler` HOC globals (see hoc.ts, globals.ts).
 * A consuming project picks these up by adding "streak-forge/globals" to its
 * tsconfig `types` array — same mechanism `bun-types` itself uses here — so
 * every widget/handler file sees `widget`/`handler` without an import.
 */
declare global {
  var widget: typeof import("./hoc").widget;

  var handler: typeof import("./hoc").handler;

  var component: typeof import("./hoc").component;

  var html: typeof import("./hoc").html;

  var head: typeof import("./hoc").head;

  var body: typeof import("./hoc").body;

  var rootLayout: typeof import("./hoc").rootLayout;

  /**
   * The browser-side counterpart — real at runtime once root.js/app.js are
   * linked on a page (any page with a `<Dynamic>` block or a lazy widget;
   * see page-build.ts's composePageFromFiles, cli/root-script.ts,
   * cli/app-script.ts). Declared here so a `Script` block's `gDom` param
   * (typed as plain `Window`, see jsx.ts's ScriptProps) can call these
   * with no cast — real streak-forge's own documented `gDom` API surface.
   */
  interface Window {
    loadDynamicComponent(id: string, callback?: () => void): void;
    loadPackage(name: string): Promise<void>;
    onVisible(
      target: Element,
      callback: (
        isIntersecting: boolean,
        target: Element,
        metadata: unknown,
      ) => void,
      options?: { onlyOnce?: boolean },
      metadata?: unknown,
    ): void;
    debounce<T extends (...args: unknown[]) => void>(
      fn: T,
      delayMs: number,
    ): (...args: Parameters<T>) => void;
    geById(id: string): HTMLElement | null;
    stall(ms: number): Promise<void>;
    setCookie(name: string, value: string, days?: number): void;
    getCookie(name: string): string | null;
    /** Internal — re-scans the DOM for `[data-widget-placeholder]` and
     *  kicks off the lazy loader again. Used by cli/spa-router.ts after a
     *  body swap; not part of the public gDom API a widget author calls. */
    __streakRunLazyLoader?: () => void;
    /** Internal — build/serve's direct-static-file loader for one lazy
     *  widget (see page-build.ts's WIDGET_SRC_ATTR/WidgetContent doc
     *  comments). Used by cli/app-script.ts's pump; not part of the public
     *  gDom API a widget author calls. */
    loadLazyWidget?(
      el: Element,
      contentUrl: string,
      callback?: () => void,
    ): void;
  }
}
