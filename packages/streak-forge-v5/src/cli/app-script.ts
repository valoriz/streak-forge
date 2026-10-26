/**
 * The client runtime's "app.js" — written verbatim to
 * `<outDir>/__streak/app.js` by buildPages. Ported from streak-forge/
 * streak-distiller's own app.js (`getAppScript`), adapted:
 *
 *  - `onVisible`/`debounce`/`geById`/`stall`/`setCookie`/`getCookie` — real
 *    streak-forge's documented `gDom` utility surface, ported verbatim
 *    (plain browser APIs, nothing streak-forge-specific to adapt).
 *  - The auto-run lazy-widget loader — same viewport-order +
 *    network-adaptive-concurrency logic streak-forge already had (moved
 *    here from the old single-file `cli/lazy-runtime.ts`), rewritten to
 *    fetch each one through root.js's `addResourceToBody` instead of a raw
 *    `fetch()` + manual `innerHTML` — the fetched fragment is now a real,
 *    self-executing script (page-build.ts's buildFragmentScript), so
 *    there's nothing left to manually inject.
 *  - The page's own script bundle ("common.js", "/docs/common.js", ...)
 *    also loads through here, computed from `location.pathname` — never a
 *    direct `<script src>` tag in the page's own HTML (that would be
 *    render-blocking, the actual thing that hurts a mobile Lighthouse
 *    score; see page-build.ts's own doc comment on the root→app→scripts
 *    chain). Simpler than the reference's own equivalent (`hydratePage`
 *    reading a per-page `widgetMetaData` blob for a content-hashed path)
 *    since streak-forge's own `pageScriptHref` is already a pure function
 *    of the URL — no per-page metadata needs embedding at all.
 *  - `window.loadPackage(name)` — a real Web-Worker asset pipeline
 *    (`cli/asset-worker.ts` does the actual fetch, off the main thread).
 *    The reference splits this into its own `asset-worker-handler.ts` +
 *    its own generated file; folded into app.js here instead since,
 *    unlike root.js/app.js/spa-router.js (each independently useful/
 *    swappable), this handler only exists to talk to the one worker file
 *    and never needs to be linked/loaded on its own.
 */
export const APP_SCRIPT_JS = `(function () {
  "use strict";

  window.onVisible = function (target, callback, options, metadata) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        callback(entry.isIntersecting, entry.target, metadata);
        if (options && options.onlyOnce) observer.disconnect();
      });
    }, { root: null, rootMargin: "0px", threshold: 0.1 });
    observer.observe(target);
  };

  window.debounce = function (fn, delayMs) {
    var timer;
    return function () {
      var args = arguments;
      var ctx = this;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(ctx, args);
      }, delayMs);
    };
  };

  window.geById = document.getElementById.bind(document);
  window.stall = function (ms) {
    return new Promise(function (resolve) {
      setTimeout(resolve, ms);
    });
  };

  window.setCookie = function (name, value, days) {
    var expires = "";
    if (days) {
      var date = new Date();
      date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
      expires = "; expires=" + date.toUTCString();
    }
    document.cookie = name + "=" + (value || "") + expires + "; path=/";
  };

  window.getCookie = function (name) {
    var nameEQ = name + "=";
    var ca = document.cookie.split(";");
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i];
      while (c.charAt(0) === " ") c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
  };

  function pickConcurrency() {
    var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (!c || !c.effectiveType) return 3;
    switch (c.effectiveType) {
      case "4g":
        return 4;
      case "3g":
        return 2;
      default:
        return 1; // 2g, slow-2g, or unrecognized
    }
  }

  function isNearViewport(el) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    return r.bottom > 0 && r.top < vh;
  }

  function orderByViewport(nodes) {
    var visible = [];
    var rest = [];
    for (var i = 0; i < nodes.length; i++) {
      (isNearViewport(nodes[i]) ? visible : rest).push(nodes[i]);
    }
    return visible.concat(rest);
  }

  function runLazyLoader() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-widget-placeholder]"));
    if (nodes.length === 0) return;

    var queue = orderByViewport(nodes);
    var concurrency = Math.min(pickConcurrency(), queue.length);
    var next = 0;

    function pump() {
      if (next >= queue.length) return;
      var el = queue[next++];
      // build/serve: a direct, static content.json path is already stamped
      // on the marker (see page-build.ts's WIDGET_SRC_ATTR) — no server
      // lookup needed, straight to window.loadLazyWidget (root.js). Dev
      // has no such attr (its markers stay generic — see resolvePageParts'
      // own dev-vs-build split) and falls back to the old composed
      // endpoint, same as before.
      var src = el.getAttribute("data-widget-src");
      if (src) {
        window.loadLazyWidget(el, src, pump);
        return;
      }
      var id = el.getAttribute("data-widget-placeholder");
      var url = "/__streak/lazy?page=" + encodeURIComponent(location.pathname) + "&id=" + encodeURIComponent(id);
      window.addResourceToBody(url, { async: true, type: "js" }, pump);
    }

    for (var i = 0; i < concurrency; i++) pump();
  }
  // Exposed globally (not just auto-run once) so the SPA router
  // (cli/spa-router.ts) can re-invoke it after a body swap — the fresh
  // page's own lazy widgets need discovering again, since root.js/app.js
  // themselves never re-run during an SPA session (see spa-router.ts's own
  // doc comment on why).
  window.__streakRunLazyLoader = runLazyLoader;

  // This page's OWN script bundle — computed straight from the URL, no
  // embedded per-page metadata needed (see this file's own doc comment).
  // Only ever loaded from here on a real, cold page load; an SPA
  // navigation reloads it itself (with eviction — a page's own bundle
  // genuinely differs per page, see cli/spa-router.ts's swapPage).
  // Skipped entirely if a direct "#streak-common-script" tag is already in
  // the document — dev mode (see page-build.ts's resolvePageParts) links
  // it directly, the old simple way, right AFTER this file's own tag (so
  // gDom globals below are already defined by the time common.js's own
  // widget scripts run) — even on a page that ALSO needs this file for its
  // own lazy/Dynamic content, loading it again here would run every
  // widget's script twice. Deferred via setTimeout(0) specifically because
  // that tag comes AFTER this one in the document — a synchronous check
  // right here would run before the browser has even parsed it, always
  // missing it; a queued macrotask runs only once the browser has finished
  // parsing the rest of the page (same technique root.js's own
  // addResourceToBody("/__streak/app.js", ...) uses for build/serve).
  setTimeout(function () {
    if (!document.getElementById("streak-common-script")) {
      var scriptPath = location.pathname.replace(/\\/+$/, "");
      window.addResourceToBody(window.__streakVersioned(scriptPath + "/common.js"), { async: true, maxRetries: 1, type: "js" });
    }
  }, 0);

  runLazyLoader();

  // loadPackage(name) — Worker bootstrapped lazily, once, the first time
  // it's actually called (most pages never call it at all). Single-asset-
  // id-per-call only (unlike the reference's own loadAsset, which also
  // accepts an array under one logical group) — streak-forge's own
  // documented loadPackage usage is always a single name at a time
  // ("gDom.loadPackage('js/motion.js')"), so the extra generality isn't
  // needed here.
  var worker = null;
  var inProgressAssets = {};
  var cachedAssets = {};
  var callbacksPerAsset = {};
  var cachedAssetOrder = [];
  var MAX_CACHED_ASSETS = 50;

  function normalizeMimeType(mime) {
    if (!mime) return undefined;
    return mime.split(";")[0].trim().toLowerCase();
  }

  function createScriptElement(assetId, content) {
    var el = document.getElementById(assetId);
    if (el) {
      el.textContent = content;
      return;
    }
    el = document.createElement("script");
    el.id = assetId;
    el.textContent = content;
    document.head.appendChild(el);
  }

  function createStyleElement(assetId, content) {
    var el = document.getElementById(assetId);
    if (el) {
      el.textContent = content;
      return;
    }
    el = document.createElement("style");
    el.id = assetId;
    el.textContent = content;
    document.head.appendChild(el);
  }

  function addLoadedAsset(assetId, metadata) {
    if (metadata.error) {
      console.error('Failed to load asset "' + assetId + '":', metadata.error);
      return;
    }
    var type = normalizeMimeType(metadata.type);
    if (type === "application/javascript" || type === "text/javascript") {
      createScriptElement(assetId, metadata.content);
    } else if (type === "text/css") {
      createStyleElement(assetId, metadata.content);
    } else {
      console.error('Asset "' + assetId + '" has an unsupported content type:', type);
    }
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(window.__streakVersioned("/__streak/asset-worker.js"));
    worker.addEventListener("message", function (event) {
      var message = event.data;
      if (message.type !== "ASSET_LOADED") return;
      var assetId = message.data.assetId;
      var metadata = message.data.metadata;

      if (!metadata.error) {
        cachedAssets[assetId] = metadata;
        cachedAssetOrder.push(assetId);
        while (cachedAssetOrder.length > MAX_CACHED_ASSETS) {
          delete cachedAssets[cachedAssetOrder.shift()];
        }
      }

      addLoadedAsset(assetId, metadata);
      var callbacks = callbacksPerAsset[assetId] || [];
      callbacks.forEach(function (cb) {
        cb(metadata);
      });
      delete callbacksPerAsset[assetId];
      delete inProgressAssets[assetId];
    });
    return worker;
  }

  window.loadAsset = function (assetId, callback) {
    if (cachedAssets[assetId]) {
      var metadata = cachedAssets[assetId];
      addLoadedAsset(assetId, metadata);
      if (callback) callback(metadata);
      return;
    }
    if (!callbacksPerAsset[assetId]) callbacksPerAsset[assetId] = [];
    if (callback) callbacksPerAsset[assetId].push(callback);
    if (inProgressAssets[assetId]) return;
    inProgressAssets[assetId] = true;
    ensureWorker().postMessage({ type: "LOAD_ASSET", assetId: assetId, id: assetId, version: window.__streakVersion });
  };

  window.loadPackage = function (name) {
    return new Promise(function (resolve, reject) {
      try {
        window.loadAsset(name, function (metadata) {
          if (metadata.error) reject(new Error("Failed to load asset: " + name));
          else resolve();
        });
      } catch (error) {
        reject(error);
      }
    });
  };
})();
`;
