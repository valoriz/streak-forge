/**
 * The client runtime's opt-in "spa-router.js" — written to
 * `<outDir>/__streak/spa-router.js` only when `buildPages({ spa: true })`,
 * and only linked on a page when that's set (see page-build.ts's
 * composePageFromFiles). Ships as its own file, same reasoning as the
 * reference: whether a site behaves as an SPA depends purely on whether
 * this one extra `<script>` tag is linked at all — remove it and the site
 * is a normal, fully server-rendered site again, no other code changes.
 *
 * Ported from streak-forge/streak-distiller's own spa-router.js
 * (`getSpaRouter`), adapted:
 *  - Fetches `pageJsonHref`'s shape (page-build.ts's composePageAsJson)
 *    instead of a pre-built static `index.json` file — computed fresh,
 *    per request, same as every other page composition in this package
 *    (see mock-worker-server.ts's matching route).
 *  - `swapPage` does NOT embed a page's own script bundle as a literal
 *    `<script>` tag inside the swapped `bodyHtml` — setting `.innerHTML`
 *    never executes embedded `<script>` tags (the same bug already fixed
 *    once this session for lazy/Dynamic fragments). Instead it loads
 *    `data.scriptHref` explicitly through root.js's `addResourceToBody`
 *    (forcing a fresh fetch — a page's own script bundle differs per page,
 *    unlike a real static asset), and re-invokes app.js's lazy-widget
 *    loader directly. root.js/app.js themselves are never re-fetched
 *    during an SPA session — their own globals (`addResourceToBody`,
 *    `loadDynamicComponent`, `loadPackage`, ...) persist across
 *    navigations since it's the same page, never actually reloaded.
 */
export const SPA_ROUTER_JS = `(function () {
  "use strict";

  function isSameOrigin(url) {
    return url.origin === location.origin;
  }

  window.__sy_nav_start = window.__sy_nav_start || Date.now();
  var navigationToken = 0;

  function jsonUrlFor(pathname) {
    var clean = pathname.replace(/\\/index\\.html$/, "").replace(/\\/$/, "");
    return clean + "/index.json";
  }

  function syncAttributes(el, attrs) {
    Array.prototype.slice.call(el.attributes).forEach(function (attr) {
      if (!(attr.name in attrs)) el.removeAttribute(attr.name);
    });
    Object.keys(attrs).forEach(function (name) {
      if (el.getAttribute(name) !== attrs[name]) el.setAttribute(name, attrs[name]);
    });
  }

  // No PRESERVE_HEAD_SELECTOR needed here (unlike the reference) — root.js/
  // app.js/spa-router.js are all linked at the end of <body>, streak-forge's
  // own established convention (same spot common.js already used), never
  // inside <head> — reconcileHead only ever touches <head>'s own children,
  // so there's nothing of the runtime's own to accidentally tear down here.
  function reconcileHead(newHeadHtml) {
    var template = document.createElement("template");
    template.innerHTML = newHeadHtml;
    while (document.head.firstChild) document.head.removeChild(document.head.firstChild);
    Array.prototype.slice.call(template.content.children).forEach(function (child) {
      document.head.appendChild(child);
    });
  }

  function swapPage(data) {
    if (data.htmlAttributes) syncAttributes(document.documentElement, data.htmlAttributes);
    if (data.bodyAttributes) syncAttributes(document.body, data.bodyAttributes);
    if (typeof data.headHtml === "string") reconcileHead(data.headHtml);
    if (typeof data.bodyHtml === "string") document.body.innerHTML = data.bodyHtml;

    // Tear down whatever the PREVIOUS page's widget scripts registered
    // globally (event listeners, timers, rAF loops — see root.js's
    // generation tracking) before the new page's scripts get a chance to
    // run, then move to a fresh generation so what THEY register isn't
    // immediately swept up too.
    if (window.__cleanupGeneration) window.__cleanupGeneration(window.__generation || 0);
    window.__generation = (window.__generation || 0) + 1;

    if (data.scriptHref) {
      // A page's own script bundle differs per page (real per-instance
      // Script options) — force a real fetch even though the URL might be
      // the exact same string as a previous page's (e.g. "/common.js"),
      // same reasoning root.js's addResourceToBody doc comment covers.
      delete window.loadedResources[data.scriptHref];
      window.addResourceToBody(data.scriptHref, { async: true, type: "js" });
    }

    // Fresh page, fresh [data-widget-placeholder] elements to discover —
    // root.js/app.js themselves don't re-run, but their own lazy loader
    // needs invoking again against the new DOM.
    if (window.__streakRunLazyLoader) window.__streakRunLazyLoader();
  }

  function getEligibleHref(el) {
    var anchor = el && el.closest ? el.closest("a[href]") : null;
    if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download") || anchor.hasAttribute("data-no-spa")) {
      return null;
    }
    var href = anchor.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#" || href.indexOf("mailto:") === 0 || href.indexOf("tel:") === 0) return null;
    return anchor.href;
  }

  var prefetchCache = {};
  var prefetchOrder = [];
  var MAX_PREFETCH_CACHE = 20;

  function prefetchPathname(pathname) {
    if (prefetchCache[pathname] || pathname === location.pathname) return;

    if (prefetchOrder.length >= MAX_PREFETCH_CACHE) {
      delete prefetchCache[prefetchOrder.shift()];
    }

    var promise = fetch(jsonUrlFor(pathname), { cache: "no-cache" }).then(function (res) {
      if (!res.ok) throw new Error("SPA prefetch failed with status " + res.status);
      return res.json();
    });
    promise.catch(function () {
      delete prefetchCache[pathname];
    });
    prefetchCache[pathname] = promise;
    prefetchOrder.push(pathname);
  }

  function navigate(href, isPopstate) {
    var target = new URL(href, location.href);

    if (!isSameOrigin(target)) {
      location.href = href;
      return;
    }

    var myToken = ++navigationToken;
    var fromPathname = location.pathname;

    var prefetched = prefetchCache[target.pathname];
    delete prefetchCache[target.pathname];
    var dataPromise =
      prefetched ||
      fetch(jsonUrlFor(target.pathname), { cache: "no-cache" }).then(function (res) {
        if (!res.ok) throw new Error("SPA navigation fetch failed with status " + res.status);
        return res.json();
      });

    dataPromise
      .then(function (data) {
        if (myToken !== navigationToken) return; // a newer navigate() call already won the race

        if (!isPopstate) {
          history.pushState({ spa: true }, "", target.pathname + target.search + target.hash);
        }
        window.dispatchEvent(new CustomEvent("sf:pageunload", { detail: { from: fromPathname } }));
        swapPage(data);
        window.scrollTo(0, 0);
        window.dispatchEvent(new CustomEvent("sf:pageload", { detail: { pathname: location.pathname, from: fromPathname } }));
      })
      .catch(function (error) {
        if (myToken !== navigationToken) return;
        console.error("SPA navigation failed, falling back to a full page load:", error);
        location.href = href;
      });
  }

  // Raw/untracked registration — root.js wraps addEventListener so every
  // WIDGET's own listeners get torn down by swapPage's generation cleanup
  // above; these two are the router's OWN infrastructure, not per-page
  // content, and must survive forever instead. Falls back to the normal
  // path if the raw refs aren't there for some reason (shouldn't happen —
  // root.js always runs first — but a permanently-broken router beats a
  // hard failure here).
  var rawListeners = window.__rawListeners;
  var rawDocListen = rawListeners ? rawListeners.doc : document.addEventListener.bind(document);
  var rawWinListen = rawListeners ? rawListeners.win : window.addEventListener.bind(window);

  rawDocListen("click", function (event) {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    var href = getEligibleHref(event.target);
    if (!href) return;

    var target = new URL(href, location.href);
    if (!isSameOrigin(target)) return;
    if (target.pathname === location.pathname && target.search === location.search) return;

    event.preventDefault();
    navigate(href);
  });

  rawWinListen("popstate", function () {
    navigate(location.href, true);
  });

  rawDocListen("mouseover", function (event) {
    var href = getEligibleHref(event.target);
    if (!href) return;
    var target = new URL(href, location.href);
    if (!isSameOrigin(target) || target.pathname === location.pathname) return;
    prefetchPathname(target.pathname);
  });
  rawDocListen(
    "touchstart",
    function (event) {
      var href = getEligibleHref(event.target);
      if (!href) return;
      var target = new URL(href, location.href);
      if (!isSameOrigin(target) || target.pathname === location.pathname) return;
      prefetchPathname(target.pathname);
    },
    { passive: true },
  );
})();
`;
