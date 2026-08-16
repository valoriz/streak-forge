import { CONTENT_ENDPOINT, WIDGET_META_ID } from "../constants";

// Runs in the browser. Written as a real, readable function and stringified
// into the page (no build step in dev) - same technique streak/components'
// <Script> uses for widget-authored scripts.
const coreRuntime = (
  win: any,
  opts: { endpoint: string; widgetMetaId: string },
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
};

export const buildClientScript = (lazyWidgetIds: string[]): string => {
  const meta = `<script type="application/json" id="${WIDGET_META_ID}">${JSON.stringify(lazyWidgetIds)}</script>`;
  const runtime = `<script>(${coreRuntime.toString()})(window, ${JSON.stringify(
    {
      endpoint: CONTENT_ENDPOINT,
      widgetMetaId: WIDGET_META_ID,
    },
  )});</script>`;
  return meta + runtime;
};
