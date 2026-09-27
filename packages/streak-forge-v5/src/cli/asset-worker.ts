/**
 * The client runtime's "asset-worker.js" — written verbatim to
 * `<outDir>/__streak/asset-worker.js` by buildPages. Never linked as a
 * `<script>` tag itself — app.js's `loadPackage` instantiates it directly
 * (`new Worker("/__streak/asset-worker.js")`) the first time it's called.
 * Ported near-verbatim from streak-forge/streak-distiller's own
 * `getAssetWorker` (worker-handlers.ts) — a real dedicated Worker so the
 * asset fetch itself never blocks the main thread, and so a strict CSP can
 * allow `worker-src` independently of `script-src`.
 *
 * Fetches from `/assets/<id>` — streak-forge's existing `public/assets/`
 * convention, the same one the SKILL.md docs already document for
 * `gDom.loadPackage`.
 */
export const ASSET_WORKER_JS = `(function () {
  "use strict";

  var ASSET_FETCH_TIMEOUT_MS = 10000;
  var ASSET_FETCH_MAX_RETRIES = 2;
  var ASSET_FETCH_RETRY_BASE_MS = 300;

  function handleLoadAsset(assetId, callback, attempt) {
    attempt = attempt || 0;
    var controller = new AbortController();
    var timeoutId = setTimeout(function () {
      controller.abort();
    }, ASSET_FETCH_TIMEOUT_MS);
    var cleanId = assetId.replace(/^\\/+/, "");

    fetch("/assets/" + cleanId, { signal: controller.signal })
      .then(function (response) {
        clearTimeout(timeoutId);
        // Check status BEFORE reading the body — an error page's body
        // (e.g. a 404 HTML page) must never be treated as valid asset
        // content just because the fetch itself didn't throw.
        if (!response.ok) {
          throw new Error("Failed to load asset: " + response.status + " " + response.statusText);
        }
        return response.text().then(function (content) {
          callback({ content: content, type: response.headers.get("Content-Type") || "text/plain" });
        });
      })
      .catch(function (error) {
        clearTimeout(timeoutId);
        if (attempt < ASSET_FETCH_MAX_RETRIES) {
          setTimeout(function () {
            handleLoadAsset(assetId, callback, attempt + 1);
          }, ASSET_FETCH_RETRY_BASE_MS * Math.pow(2, attempt));
          return;
        }
        callback({ error: error && error.message ? error.message : "An unexpected error occurred while loading the asset." });
      });
  }

  self.addEventListener("message", function (event) {
    var data = event.data;
    if (data.type !== "LOAD_ASSET") {
      console.error("Unknown message type:", data.type);
      return;
    }
    handleLoadAsset(data.assetId, function (metadata) {
      self.postMessage({ type: "ASSET_LOADED", data: { id: data.id, assetId: data.assetId, metadata: metadata } });
    });
  });
})();
`;
