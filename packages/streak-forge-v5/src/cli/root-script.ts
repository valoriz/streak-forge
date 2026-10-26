/**
 * The client runtime's "root.js" — written verbatim to
 * `<outDir>/__streak/root.js` by buildPages, a real static file from that
 * point on. Ported from real streak-forge/streak-distiller's own root.js
 * (`getCoreScript` in streak-distiller's prepareForSiteOnlyOnce/index.ts),
 * adapted to streak-forge's context — see this module's own doc comment on
 * what changed and why:
 *
 *  - Generation-tracked `addEventListener`/`setInterval`/`setTimeout`/
 *    `requestAnimationFrame` + `__cleanupGeneration` — ported near-verbatim,
 *    no streak-forge-specific dependency in this part at all. Exists so a
 *    future SPA re-navigation can tear down whatever a widget's own script
 *    (or third-party code loaded via loadPackage) registered globally,
 *    without requiring any cooperation from that code.
 *  - `addResourceToBody(src, options, callback)` — retry + 15s timeout +
 *    in-flight/loaded dedup, creates a real `<script>`/`<link>` element
 *    (never `innerHTML`, which never executes embedded scripts) — the one
 *    loading primitive everything else in this runtime (app.js's lazy
 *    loader, loadPackage's bootstrap, loadDynamicComponent below) goes
 *    through. `options.type` overrides its extension-sniffing (`"js"`/
 *    `"css"`) — needed here because streak-forge's own lazy/Dynamic fetch
 *    URLs are query-string-routed (`/__streak/lazy?page=&id=`), not real
 *    per-file paths with an extension the way the reference's own URLs are.
 *  - `window.loadDynamicComponent(id, callback)` — same fetch-once-per-visit
 *    eviction idea as the reference, rebuilt on top of streak-forge's own
 *    `/__streak/dynamic?id=` endpoint (page-build.ts's composeDynamicFragment
 *    — a real, self-executing script, so no separate "apply this data to
 *    the DOM" call is needed here the way the reference's own
 *    `applyWidgetDataToDom` is; the fetched script does that itself).
 */
export const ROOT_SCRIPT_JS = `(function () {
  "use strict";

  // Build/serve links this file as root.js?v=<page version>. That version
  // is put on every runtime/asset URL this runtime requests itself
  // (app.js, common.js, asset-worker.js, loadPackage assets), so all of
  // them are cache-busted together. Dev has no ?v= — URLs stay as-is.
  var ownScript = document.currentScript;
  var versionMatch = ownScript && /[?&]v=([^&#]+)/.exec(ownScript.src);
  window.__streakVersion = versionMatch ? versionMatch[1] : "";
  window.__streakVersioned = function (url) {
    return window.__streakVersion && url.indexOf("?") === -1 ? url + "?v=" + window.__streakVersion : url;
  };

  window.__generation = window.__generation || 0;
  var trackedListeners = [];
  var trackedTimers = [];

  var rawWinAddEventListener = window.addEventListener.bind(window);
  var rawDocAddEventListener = document.addEventListener.bind(document);
  window.__rawListeners = { win: rawWinAddEventListener, doc: rawDocAddEventListener };

  function wrapAddEventListener(target, original) {
    target.addEventListener = function (type, listener, options) {
      trackedListeners.push({ target: target, type: type, listener: listener, options: options, gen: window.__generation });
      original(type, listener, options);
    };
  }
  wrapAddEventListener(window, rawWinAddEventListener);
  wrapAddEventListener(document, rawDocAddEventListener);

  var rawSetInterval = window.setInterval.bind(window);
  window.setInterval = function (fn, delay) {
    var id = rawSetInterval(fn, delay);
    trackedTimers.push({ id: id, kind: "interval", gen: window.__generation });
    return id;
  };

  var rawSetTimeout = window.setTimeout.bind(window);
  window.setTimeout = function (fn, delay) {
    var id = rawSetTimeout(fn, delay);
    trackedTimers.push({ id: id, kind: "timeout", gen: window.__generation });
    return id;
  };

  if (typeof window.requestAnimationFrame === "function") {
    var rawRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function (fn) {
      var id = rawRAF(fn);
      trackedTimers.push({ id: id, kind: "raf", gen: window.__generation });
      return id;
    };
  }

  window.__cleanupGeneration = function (gen) {
    for (var i = trackedListeners.length - 1; i >= 0; i--) {
      var entry = trackedListeners[i];
      if (entry.gen !== gen) continue;
      entry.target.removeEventListener(entry.type, entry.listener, entry.options);
      trackedListeners.splice(i, 1);
    }
    for (var j = trackedTimers.length - 1; j >= 0; j--) {
      var t = trackedTimers[j];
      if (t.gen !== gen) continue;
      if (t.kind === "interval") window.clearInterval(t.id);
      else if (t.kind === "timeout") window.clearTimeout(t.id);
      else if (typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(t.id);
      trackedTimers.splice(j, 1);
    }
  };

  window.loadedResources = window.loadedResources || {};
  var RESOURCE_LOAD_TIMEOUT_MS = 15000;
  var RESOURCE_RETRY_BASE_MS = 500;

  window.addResourceToBody = function (src, options, callback) {
    var loadedResources = window.loadedResources;
    var ext = (options && options.type) || (src.split("?")[0].split(".").pop() || "").toLowerCase();

    if (loadedResources[src]) {
      // A resource this cache thinks is "already loaded" is only STILL
      // true while its own element is still attached. That's usually a
      // safe assumption for js — executing code has lasting effects
      // (globals defined) independent of the <script> tag itself — EXCEPT
      // a widget's own script.js/bundle.js is exactly the opposite: its
      // whole job is looking up ONE SPECIFIC element by id and attaching a
      // listener to THAT instance. cli/spa-router.ts's swapPage does a
      // full document.body.innerHTML replace on every navigation, which
      // destroys that element (and any <link> a lazy widget's CSS used
      // too) without this cache ever finding out — so a lazy widget or
      // Dynamic block loaded once, then revisited after an SPA nav, skips
      // re-running its own script entirely (the cache says "done") and its
      // buttons/handlers silently stop working, even though its OWN
      // fresh DOM node has no listener on it at all. Found and confirmed
      // with a real browser test (click a lazy widget's button after
      // navigating away and back: nothing happens; a hard refresh works
      // fine). root.js/app.js themselves never hit this path a second
      // time (nothing ever re-requests them during an SPA session), so
      // this check costs nothing there. Falling through to a real reload
      // otherwise costs nothing either (the browser's own HTTP cache
      // already has the bytes).
      var selector = ext === "css" ? 'link[href="' : ext === "js" ? 'script[src="' : null;
      if (!selector || document.querySelector(selector + CSS.escape(src) + '"]')) {
        loadedResources[src]
          .then(function () {
            if (callback) callback();
          })
          .catch(function (err) {
            console.error("Failed to load resource:", src, err);
          });
        return;
      }
      delete loadedResources[src];
    }

    var maxRetries = (options && options.maxRetries) || 0;

    var resourcePromise = new Promise(function (resolve, reject) {
      function tryLoad(attempt) {
        var el = null;
        var settled = false;

        function onError(err) {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          if (el && el.remove) el.remove();
          if (attempt < maxRetries) {
            setTimeout(function () {
              tryLoad(attempt + 1);
            }, RESOURCE_RETRY_BASE_MS * Math.pow(2, attempt));
          } else {
            reject(err);
          }
        }

        var timeoutId = setTimeout(function () {
          onError(new Error("Timed out loading resource after " + RESOURCE_LOAD_TIMEOUT_MS + "ms: " + src));
        }, RESOURCE_LOAD_TIMEOUT_MS);

        if (ext === "js") {
          var script = document.createElement("script");
          script.src = src;
          if (options && options.async) script.async = true;
          if (options && options.defer) script.defer = true;
          if (options && options.attributes) {
            for (var k in options.attributes) script.setAttribute(k, options.attributes[k]);
          }
          script.onload = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve();
          };
          script.onerror = function (err) {
            onError(err);
          };
          el = script;
        } else if (ext === "css") {
          var link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = src;
          if (options && options.attributes) {
            for (var k2 in options.attributes) link.setAttribute(k2, options.attributes[k2]);
          }
          link.onload = function () {
            if (settled) return;
            settled = true;
            clearTimeout(timeoutId);
            resolve();
          };
          link.onerror = function (err) {
            onError(err);
          };
          el = link;
        } else {
          clearTimeout(timeoutId);
          reject(new Error("Unsupported resource type: " + ext));
          return;
        }

        document.body.appendChild(el);
      }

      tryLoad(0);
    });

    loadedResources[src] = resourcePromise;
    resourcePromise
      .then(function () {
        if (callback) callback();
      })
      .catch(function (err) {
        console.error("Failed to load resource:", src, err);
        delete loadedResources[src];
      });
  };

  window.__loadedDynamicIds = window.__loadedDynamicIds || {};
  window.loadDynamicComponent = function (id, callback) {
    // Build/serve's direct-static-file path (see page-build.ts's
    // DYNAMIC_SRC_ATTR doc comment) — the slot's own marker already
    // carries its content.json's exact path when present, so this skips
    // straight to loadLazyWidget (below), same as a lazy widget does. Dev
    // has no such attr and falls back to the old composed endpoint.
    var el = document.querySelector('[data-dynamic-slot="' + id + '"]');
    var directSrc = el ? el.getAttribute("data-dynamic-src") : null;
    if (el && directSrc) {
      window.loadLazyWidget(el, directSrc, callback);
      return;
    }
    var url = "/__streak/dynamic?id=" + encodeURIComponent(id);
    if (!window.__loadedDynamicIds[id]) {
      window.__loadedDynamicIds[id] = true;
      delete window.loadedResources[url];
    }
    window.addResourceToBody(url, { async: true, type: "js" }, callback);
  };

  // Build/serve's direct-static-file path for a lazy widget (see
  // page-build.ts's WIDGET_SRC_ATTR/WidgetContent doc comments) — no
  // server-side composition at all: contentUrl is a real content.json
  // already sitting on disk, fetched exactly like any other static asset.
  // Same css-then-html-then-script order the OLD server-composed fragment
  // script used to run (buildFragmentScript), just performed here in the
  // browser instead of generated fresh per request on the server.
  window.loadLazyWidget = function (el, contentUrl, callback) {
    fetch(contentUrl)
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load " + contentUrl + ": " + res.status);
        return res.json();
      })
      .then(function (content) {
        // content.json paths are outDir-relative ("widgets/X/X.css") —
        // resolve from the site root, never from the current page's URL.
        function rootUrl(href) {
          return href.charAt(0) === "/" || /^[a-z][a-z0-9+.-]*:/i.test(href) ? href : "/" + href;
        }
        // The page version stamped on content.json's own URL (?v=) goes on
        // every asset it lists too, so CSS/JS are cache-busted the same way.
        var versionMatch = /[?&]v=([^&#]+)/.exec(contentUrl);
        function assetUrl(href) {
          var url = rootUrl(href);
          return versionMatch && url.indexOf("?") === -1 ? url + "?v=" + versionMatch[1] : url;
        }
        var inserted = false;
        function insertAndRun() {
          if (inserted) return;
          inserted = true;
          var tmp = document.createElement("div");
          tmp.innerHTML = content.html;
          // Every top-level node, not just the first: a widget may
          // render several root elements (e.g. a backdrop + a drawer).
          el.replaceWith.apply(el, Array.prototype.slice.call(tmp.childNodes));
          if (content.scriptHref) {
            window.addResourceToBody(assetUrl(content.scriptHref), { async: true, type: "js" }, callback);
          } else if (callback) {
            callback();
          }
        }
        if (content.cssHref) {
          var cssUrl = assetUrl(content.cssHref);
          window.addResourceToBody(cssUrl, { type: "css" }, insertAndRun);
          // A failed stylesheet must not drop the widget: show it anyway
          // (possibly unstyled), same as the dev fragment path.
          var cssLoad = window.loadedResources[cssUrl];
          if (cssLoad) cssLoad.catch(insertAndRun);
        } else {
          insertAndRun();
        }
      })
      .catch(function (err) {
        console.error("Failed to load lazy widget:", contentUrl, err);
        if (callback) callback();
      });
  };

  // The ONE thing the page's own HTML links directly is this file, deferred
  // — root.js loads app.js itself, programmatically, right after its own
  // synchronous setup above finishes (setTimeout 0, matching the real
  // reference exactly: "root.js/app.js never re-fetch during an SPA session
  // by design"). Keeps the initial HTML down to a single deferred script
  // tag instead of several render-blocking ones — the actual lever for a
  // good mobile Lighthouse score, not just "fewer files".
  setTimeout(function () {
    window.addResourceToBody(window.__streakVersioned("/__streak/app.js"), { defer: true, type: "js" });
  }, 0);
})();
`;
