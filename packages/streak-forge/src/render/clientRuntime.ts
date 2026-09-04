import { CONTENT_ENDPOINT, WIDGET_META_ID } from "../constants";

// Runs in the browser. Written as a real, readable function and stringified
// into the page (no build step in dev) - same technique streak/components'
// <Script> uses for widget-authored scripts.
const coreRuntime = (
  win: any,
  opts: { endpoint: string; widgetMetaId: string; spa: boolean },
) => {
  win.__streakLoaded = win.__streakLoaded || new Set();
  win.__streakLoadedResources = win.__streakLoadedResources || {};

  win.addResourceToBody = function (
    src: string,
    options: { async?: boolean } | undefined,
    callback?: () => void,
  ) {
    const loaded = win.__streakLoadedResources;
    if (loaded[src]) {
      loaded[src].then(() => {
        if (callback) callback();
      });
      return;
    }
    const ext = (src.split("?")[0] || src).split(".").pop();
    const promise = new Promise<void>((resolve, reject) => {
      let el: HTMLElement;
      if (ext === "js") {
        const script = win.document.createElement("script");
        script.src = src;
        if (options?.async) script.async = true;
        script.onload = () => resolve();
        script.onerror = (e: any) => reject(e);
        el = script;
      } else if (ext === "css") {
        const link = win.document.createElement("link");
        link.rel = "stylesheet";
        link.href = src;
        link.onload = () => resolve();
        link.onerror = (e: any) => reject(e);
        el = link;
      } else {
        reject(new Error("Unsupported resource: " + src));
        return;
      }
      win.document.body.appendChild(el);
    });
    loaded[src] = promise;
    promise
      .then(() => callback && callback())
      .catch((err: Error) => {
        console.error("streak: failed to load resource", src, err);
        delete loaded[src];
      });
  };

  win.loadPackage = function (name: string) {
    return new Promise((resolve, reject) => {
      try {
        win.addResourceToBody(`/assets/${name}`, { async: true }, () =>
          resolve(undefined),
        );
      } catch (err) {
        reject(err);
      }
    });
  };

  // Generic window-level utility globals - mirrors the same functions
  // streak-distiller injects into every distilled build (getAppScript in
  // prepareForSiteOnlyOnce/index.ts). A widget's <Script> block can't tell
  // whether it's running under `streak-forge dev` or a distilled production
  // build, so it has to be able to call these in both. Only the plain
  // utilities are mirrored here - widget-loading/hydration (addWidgetToBody,
  // hydratePage, the SPA router) already has its own dev-appropriate
  // implementation above/below, fetching from CONTENT_ENDPOINT instead of
  // distiller's versioned static JSON paths.
  win.geById = win.document.getElementById.bind(win.document);

  win.debounce = function (func: (...args: any[]) => void, delay: number) {
    let timer: ReturnType<typeof setTimeout>;
    return function (this: unknown, ...args: any[]) {
      clearTimeout(timer);
      timer = setTimeout(() => func.apply(this, args), delay);
    };
  };

  win.onVisible = function (
    target: Element,
    callback: (isIntersecting: boolean, target: Element, metadata: any) => void,
    options?: { onlyOnce?: boolean },
    metadata?: any,
  ) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          callback(entry.isIntersecting, entry.target, metadata);
          if (options?.onlyOnce) observer.disconnect();
        });
      },
      { root: null, rootMargin: "0px", threshold: 0.1 },
    );
    observer.observe(target);
  };

  win.stall = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  win.setCookie = function (name: string, value: string, days?: number) {
    let expires = "";
    if (days) {
      const date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = `; expires=${date.toUTCString()}`;
    }
    win.document.cookie = `${name}=${value || ""}${expires}; path=/`;
  };

  win.getCookie = function (name: string): string | null {
    const nameEQ = `${name}=`;
    const ca = win.document.cookie.split(";");
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  };

  const applyContent = (
    type: string,
    id: string,
    data: { html: string; scripts?: { id: string; content: string }[] },
    callback?: () => void,
  ) => {
    const key = `${type}_${id}`;
    if (win.__streakLoaded.has(key)) {
      if (callback) callback();
      return;
    }
    const placeholder = win.document.querySelector(
      `[component-id="${id}"][component-type="${type}"]`,
    );
    if (placeholder) {
      placeholder.outerHTML = data.html;
      win.__streakLoaded.add(key);
    } else {
      console.warn(`streak: no placeholder found for ${type}/${id}`);
    }
    (data.scripts || []).forEach((s) => {
      const scriptKey = `script_${s.id}`;
      if (win.__streakLoaded.has(scriptKey)) return;
      const scriptEl = win.document.createElement("script");
      scriptEl.id = s.id;
      scriptEl.innerHTML = s.content;
      win.document.body.appendChild(scriptEl);
      win.__streakLoaded.add(scriptKey);
    });
    if (callback) callback();
  };

  const fetchContent = (type: string, id: string, callback?: () => void) => {
    const key = `${type}_${id}`;
    if (win.__streakLoaded.has(key)) {
      if (callback) callback();
      return;
    }
    const url = `${opts.endpoint}?page=${encodeURIComponent(win.location.pathname)}&type=${type}&id=${encodeURIComponent(id)}`;
    fetch(url)
      .then((res: Response) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then((data: any) => applyContent(type, id, data, callback))
      .catch((err: Error) => {
        console.error(`streak: failed to fetch ${type}/${id}`, err);
        if (callback) callback();
      });
  };

  win.loadDynamicComponent = function (id: string, callback?: () => void) {
    fetchContent("c", id, callback);
  };

  win.addWidgetToBody = function (id: string, callback?: () => void) {
    fetchContent("w", id, callback);
  };

  const metaEl = win.document.getElementById(opts.widgetMetaId);
  const lazyWidgetIds: string[] = metaEl
    ? JSON.parse(metaEl.textContent || "[]")
    : [];

  const loadNext = (ids: string[]) => {
    const [first, ...rest] = ids;
    if (!first) return;
    win.addWidgetToBody(first, () => loadNext(rest));
  };
  loadNext(lazyWidgetIds);

  // ── Dev SPA router ────────────────────────────────────────────────────────
  // Disabled when opts.spa is false (set STREAK_DEV_SPA=false in the shell).
  if (!opts.spa) return;
  // Intercepts same-origin link clicks and popstate, fetches the new page HTML
  // from the dev server, and swaps the body without a full reload — giving the
  // same navigation feel as the production SPA router. Dev-only, intentionally
  // simpler than the production version (no prefetch, no distillerVersion
  // guard, no bounded-concurrency widget loading).
  const swapPage = (href: string, push: boolean) => {
    fetch(href, { headers: { Accept: "text/html" } })
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        // Reset dev runtime state so widgets and dynamic components on the new
        // page are treated as not-yet-loaded.
        win.__streakLoaded = new Set();
        win.__streakLoadedResources = {};
        if (push) win.history.pushState(null, "", href);
        win.document.title = doc.title;
        win.document.body.innerHTML = doc.body.innerHTML;
        // innerHTML does not execute <script> tags — re-create each one so the
        // browser runs it. Skip data scripts (type=application/json etc.) since
        // those are read by coreRuntime as data, not executed as code.
        win.document.body
          .querySelectorAll("script")
          .forEach((old: HTMLScriptElement) => {
            const t = old.type;
            if (t && t !== "text/javascript" && t !== "module") return;
            const s = win.document.createElement("script");
            Array.from(old.attributes).forEach((a: Attr) =>
              s.setAttribute(a.name, a.value),
            );
            if (!old.src) s.textContent = old.textContent;
            old.replaceWith(s);
          });
        win.dispatchEvent(
          new CustomEvent("sf:pageload", { detail: { path: href } }),
        );
      })
      .catch((err) => {
        console.warn(
          "[streak dev] spa nav failed, falling back to full reload:",
          err,
        );
        win.location.href = href;
      });
  };

  win.document.addEventListener(
    "click",
    (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as Element).closest(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!a || (a.target && a.target !== "_self")) return;
      try {
        const url = new URL(a.href, win.location.href);
        if (url.origin !== win.location.origin) return;
        // Hash-only change on same page — let browser handle scroll, no swap.
        if (
          url.hash &&
          url.pathname === win.location.pathname &&
          url.search === win.location.search
        )
          return;
        e.preventDefault();
        swapPage(url.pathname + url.search + url.hash, true);
      } catch {
        // Unparseable href — let browser handle it.
      }
    },
    true,
  );

  win.addEventListener("popstate", () => {
    swapPage(
      win.location.pathname + win.location.search + win.location.hash,
      false,
    );
  });
};

export const buildClientScript = (lazyWidgetIds: string[]): string => {
  // STREAK_DEV_SPA=false disables the dev SPA router. Defaults to enabled.
  const spa = process.env.STREAK_DEV_SPA !== "false";
  const meta = `<script type="application/json" id="${WIDGET_META_ID}">${JSON.stringify(lazyWidgetIds)}</script>`;
  const runtime = `<script>(${coreRuntime.toString()})(window, ${JSON.stringify(
    {
      endpoint: CONTENT_ENDPOINT,
      widgetMetaId: WIDGET_META_ID,
      spa,
    },
  )});</script>`;
  return meta + runtime;
};
