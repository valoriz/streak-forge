---
name: streak-forge
description: >
  Deep context for building Streak.js sites with streak-forge.
  Covers project structure, sitemap, widgets, layouts, handlers, Script blocks,
  GDom API, SPA events, lazy loading, Dynamic components, and Middleware.
  Load before creating or editing any streak-forge widget, handler, layout, or Script block.
  Triggers: "streak", "widget", "handler", "GDom", "Script block", "lazy load", "sf:pageload",
  "addFunctionToDom", "loadPackage", "WidgetPlaceholder", "streak.sitemap.json".
---

# Streak-forge Expert Skill

## What Streak.js Is

Streak.js is a zero-runtime static site generator. Every page is pre-rendered to plain HTML at build time. Nothing framework-related ships to the browser — only the generated HTML plus a tiny client runtime that enables lazy widgets, dynamic components, and client-side JS via `Script` blocks.

**Key constraints:**
- No hydration — the HTML is final
- No virtual DOM or React in the browser
- No hooks, no state, no re-renders in widgets
- All interactivity goes inside `Script` blocks as plain browser JS

---

## Project Structure

```
my-streak-app/
├── streak.sitemap.json          # Declares every page
├── src/
│   ├── layouts/                 # Full HTML documents (MainLayout.tsx etc.)
│   ├── widgets/                 # Stateless render components
│   ├── handlers/
│   │   ├── CommonHandler.ts     # Optional — shared data for all pages
│   │   ├── Middleware.ts        # Optional — dynamic URL resolution
│   │   └── HomeDataHandler.ts   # Per-page data handlers
│   └── common/                  # Shared styles, assets, scripts
└── public/
    └── assets/
        └── js/                  # Third-party libraries for loadPackage()
```

---

## streak.sitemap.json

Every page must be declared here. `renderId` must be globally unique.

```json
[
  {
    "url": "/",
    "renderConfig": {
      "renderId": "homeRenderId",
      "metadata": { "pageName": "home" },
      "dataHandler": "HomeDataHandler",
      "rootLayout": "MainLayout",
      "version": "1.0.0",
      "widgets": [
        { "id": "PageHead", "type": "PageHead" },
        { "id": "HeroBanner", "type": "HeroBanner" },
        { "id": "ProductGrid", "type": "ProductGrid", "loadingStrategy": "lazy" }
      ]
    }
  }
]
```

**Rules:**
- `renderId` — globally unique across the entire sitemap
- `id` — unique within a page's widgets array; must match the key the handler returns and the `id` on `WidgetPlaceholder`
- `type` — must match the widget filename in `src/widgets/` exactly (case-sensitive) and the `type` on `WidgetPlaceholder`
- `loadingStrategy: "lazy"` — widget loads after page paint (below-the-fold content)
- `version` — semver string; bump it to bust widget caches on rebuild
- `dataHandler` — filename without extension; file must be in `src/handlers/`
- `metadata` — arbitrary object, passed into the handler as its first argument

---

## Layouts

A layout is the full HTML shell. It uses `WidgetPlaceholder` to mark where each widget goes.

```tsx
import { WidgetPlaceholder } from "streak-forge/components";

const MainLayout = () => (
  <html lang="en">
    <head>
      <WidgetPlaceholder id="PageHead" type="PageHead" />
    </head>
    <body>
      <WidgetPlaceholder id="HeroBanner"  type="HeroBanner"  />
      <WidgetPlaceholder id="ProductGrid" type="ProductGrid" />
    </body>
  </html>
);

export default MainLayout;
```

- `id` and `type` must exactly match the sitemap entry
- The layout itself receives no props and no data — it is a pure shell
- Only one layout per page; layouts are not reused across pages automatically (each sitemap entry declares its own)

---

## Widgets

Widgets are stateless TSX functions. They receive `props.data` which is the object the handler returned for that widget's key.

```tsx
import { Script } from "streak-forge/components";
import type { GDom } from "streak-forge/components";

type ProductCardProps = {
  data?: {
    title?: string;
    price?: number;
    imageUrl?: string;
  };
};

const ProductCard = (props: ProductCardProps) => {
  const title = props?.data?.title ?? "Untitled";
  const price = props?.data?.price ?? 0;
  const imageUrl = props?.data?.imageUrl ?? "";

  return (
    <div id="product-card">
      <img src={imageUrl} alt={title} />
      <h2>{title}</h2>
      <p>${price}</p>
      <Script id="product-card-script" options={{ title, price }}>
        {(gDom: GDom, options: { title: string; price: number }) => {
          const card = document.getElementById("product-card");
          card?.addEventListener("click", () => {
            console.log("clicked:", options.title, "for $" + options.price);
          });
        }}
      </Script>
    </div>
  );
};

export default ProductCard;
```

**Widget rules:**
- Always guard `props.data` with `?.` and `?? fallback` — data is `undefined` if the handler returned nothing for this widget
- No hooks, no useState, no useEffect — widgets are build-time templates only
- All DOM manipulation goes inside `Script` blocks
- Widget filename (e.g. `ProductCard.tsx`) must exactly match the `type` in the sitemap

---

## Data Handlers

Handlers are async functions that return data keyed by widget type. The key must match the widget's `type` in the sitemap.

```ts
// src/handlers/ProductPageHandler.ts

interface CommonData {
  branding?: { logoSrc?: string };
}

const getProductData = async (
  metadata?: Record<string, unknown>,
  { common }: { common?: CommonData } = {}
) => {
  const productId = metadata?.productId as string | undefined;
  const product = await fetchProduct(productId);

  return {
    status: 200,

    HeroBanner: {
      heading: product.name,
      imageUrl: product.imageUrl,
    },

    ProductCard: {
      title: product.name,
      price: product.price,
      imageUrl: product.imageUrl,
    },

    // Widget keys that are absent here get props.data === undefined
  };
};

export default getProductData;
```

**Handler rules:**
- Default export only — named exports are ignored
- First arg: `metadata` (the `renderConfig.metadata` from the sitemap entry)
- Second arg: `{ common }` — the return value of `CommonHandler.ts` (if it exists)
- Keys in the return object map to widget `type`, not widget `id`
- `status` is a reserved key (used internally) — don't use it for widget data
- Handler runs at build time (and on every dev request) — not in the browser

---

## CommonHandler

Reserved filename `CommonHandler.ts`. Optional. Called once per build, result passed to every page handler as `common`.

```ts
// src/handlers/CommonHandler.ts

const getCommonData = async () => {
  return {
    branding: { logoSrc: "/images/logo.svg", logoAlt: "My Site" },
    nav: { links: [{ label: "Home", href: "/" }] },
  };
};

export default getCommonData;
```

Use CommonHandler for data that is identical across all pages (site branding, navigation, global settings).

---

## Middleware

Reserved filename `Middleware.ts`. Optional. Runs before every page resolution. Return `undefined` to pass through to the sitemap; return a `RenderConfig` to override.

```ts
// src/handlers/Middleware.ts
import type { RenderConfig } from "streak-forge/core";

const resolveMiddleware = async (
  url: string,
  _req?: Request
): Promise<RenderConfig | undefined> => {
  // Dynamic route: /products/[slug] maps to the product page config
  if (url.startsWith("/products/")) {
    return {
      renderId: "productPageId",
      metadata: { slug: url.split("/").pop() },
      dataHandler: "ProductPageHandler",
      rootLayout: "MainLayout",
      version: "1.0.0",
      widgets: [
        { id: "ProductCard", type: "ProductCard" },
      ],
    };
  }
  return undefined; // fall through to sitemap
};

export default resolveMiddleware;
```

---

## Script Blocks

`Script` serialises a function body to a string at build time and ships it as an inline `<script>` IIFE. This is the ONLY way to write client-side JS in a widget.

```tsx
import { Script, type GDom } from "streak-forge/components";

<Script id="my-script" options={{ accentColor: "#818cf8", delayMs: 300 }}>
  {(gDom: GDom, options: { accentColor: string; delayMs: number }) => {
    const btn = document.getElementById("my-btn");
    if (!btn) return;
    btn.style.color = options.accentColor;
    gDom.stall(options.delayMs).then(() => btn.classList.add("ready"));
  }}
</Script>
```

### Critical Script Rules

**No closures.** The function body is serialised with `.toString()`. Variables from the outer TSX scope are NOT available in the browser.

```tsx
// WRONG — accentColor is undefined at runtime
const accentColor = props?.data?.accentColor;
<Script id="s">
  {(gDom: GDom) => {
    document.getElementById("el")!.style.color = accentColor; // undefined!
  }}
</Script>

// CORRECT — pass through options
<Script id="s" options={{ color: props?.data?.accentColor ?? "#818cf8" }}>
  {(gDom: GDom, options: { color: string }) => {
    document.getElementById("el")!.style.color = options.color;
  }}
</Script>
```

**No imports inside Script.** Load third-party code via `gDom.loadPackage()`.

**`id` must be unique on the page.** Two widgets using the same `Script` id means only the first one's script runs (`addFunctionToDom` deduplicates by id). If the same widget component is used twice on one page, use a per-instance id:

```tsx
<Script id={`product-card-${props.widgetId}`} options={{ id: props.widgetId }}>
  {(gDom: GDom, options: { id: string }) => {
    const el = document.getElementById(`card-${options.id}`);
    // ...
  }}
</Script>
```

**`options` must be JSON-serializable.** No functions, no class instances, no Symbols.

---

## GDom Type

`gDom` inside a Script is `window` extended with Streak's runtime helpers. Import the type for full autocomplete:

```tsx
import { Script, type GDom } from "streak-forge/components";
```

### Available Functions

```ts
// Load a file from public/assets/ — returns Promise, deduplicates repeat calls
gDom.loadPackage("js/motion.js"): Promise<void>

// Fetch and inject a <Dynamic id="..."> block on demand
gDom.loadDynamicComponent(id: string, callback?: () => void): void

// IntersectionObserver wrapper — fires when element enters/leaves viewport
gDom.onVisible(target, callback, { onlyOnce?: boolean }, metadata): void

// Shorthand for document.getElementById
gDom.geById(id: string): HTMLElement | null

// Standard debounce — returns debounced version of fn
gDom.debounce(fn, delayMs): fn

// Async delay — resolves after ms milliseconds
gDom.stall(ms: number): Promise<void>

// Cookie helpers
gDom.setCookie(name, value, days?: number): void
gDom.getCookie(name): string | null
```

### SPA Event Listeners

```ts
// Fires after SPA navigation completes and new page body is in DOM
gDom.addEventListener("sf:pageload", (e: CustomEvent<{ pathname: string; from: string }>) => {
  // e.detail.pathname — current page path
  // e.detail.from     — previous page path
});

// Fires just before SPA navigation replaces the body (cleanup hook)
gDom.addEventListener("sf:pageunload", (e: CustomEvent<{ from: string }>) => {
  // e.detail.from — the page that is about to be replaced
});
```

**SPA listener best practice — always remove before adding:**
```ts
// CORRECT — prevents accumulation across navigations
gDom.removeEventListener("sf:pageload", myHandler);
gDom.addEventListener("sf:pageload", myHandler);
```

---

## Dynamic Components

`<Dynamic id="...">` marks a block that is injected on demand — not at page load. Use for heavy content that should load on interaction, on scroll, or after a delay.

```tsx
import { Dynamic } from "streak-forge/components";

// In widget JSX — placeholder with a loading state:
<Dynamic id="video-player">
  <div id="video-placeholder">
    <button id="play-btn">▶ Load video</button>
  </div>
</Dynamic>

// In Script — load on button click:
<Script id="video-loader-script">
  {(gDom: GDom) => {
    document.getElementById("play-btn")?.addEventListener("click", () => {
      gDom.loadDynamicComponent("video-player", () => {
        // video-player is now in the DOM
      });
    });
  }}
</Script>
```

The dynamic component's content lives in a separate widget file and is fetched from the versioned widget directory when `loadDynamicComponent` is called.

---

## Lazy Widgets

Add `"loadingStrategy": "lazy"` in the sitemap. The runtime fetches and injects the widget HTML after the page is interactive, with adaptive concurrency based on the visitor's network speed.

```json
{ "id": "HeavySection", "type": "HeavySection", "loadingStrategy": "lazy" }
```

- Eager widgets (no `loadingStrategy`) are included in the initial HTML
- Lazy widgets are placeholders in the HTML, filled in by the client runtime
- Viewport order is respected — visible lazy widgets load before off-screen ones

---

## loadPackage

Load third-party JS or CSS from `public/assets/`. Files must be committed to git — they are not generated by any build step.

```ts
// In a Script block:
await gDom.loadPackage("js/motion.js");
// window.Motion is now available

await gDom.loadPackage("css/swiper.min.css");
// Swiper styles applied
```

- Repeat calls for the same path reuse the cached promise — safe to call in multiple widgets
- File must exist at `public/assets/{name}` before it is used

---

## onVisible (Lazy Loading Images / Animations)

```ts
const img = document.getElementById("hero-img");
gDom.onVisible(img, (isIntersecting) => {
  if (isIntersecting) img.src = img.dataset.src;
}, { onlyOnce: true }, null);
```

For multiple elements, prefer a single shared `IntersectionObserver` in a layout Script rather than one per widget.

---

## Common Vanilla JS Patterns

**Always null-check DOM queries:**
```ts
const el = document.getElementById("my-el");
if (!el) return;
el.addEventListener("click", handler);
// OR:
document.getElementById("my-el")?.addEventListener("click", handler);
```

**Clear setInterval on re-mount:**
```ts
const KEY = "__my_interval";
clearInterval((window as any)[KEY]);
(window as any)[KEY] = setInterval(tick, 3000);
```

**Cache DOM references outside handlers:**
```ts
const header = document.getElementById("main-header");
if (!header) return;
window.addEventListener("scroll", () => {
  header.classList.toggle("sticky", window.scrollY > 60);
}, { passive: true });
```

**Use `{ passive: true }` on scroll/touch:**
```ts
window.addEventListener("scroll", handler, { passive: true });
```

**Toggle classes, not inline styles:**
```ts
el.classList.toggle("active", isActive);   // correct
el.style.display = "none";                  // avoid
```

---

## CLI

```bash
streak-forge dev          # hot-reload dev server
streak-forge validate     # check Script blocks for closure leaks
streak-forge pre-build    # cache handler output (faster builds)
streak-forge build        # render all pages → out/1.0.0/raw-content.json
```

---

## What NOT to Call Directly

These are internal runtime functions — do not use them in widget Script blocks:

- `addFunctionToDom` — called by the build system automatically
- `addResourceToBody` — internal resource loader
- `addWidgetToBody` — internal widget injector
- `applyWidgetDataToDom` — internal widget hydration
- `hydratePage` — internal page reset on SPA navigation
- `window.loadedScripts / window.loadedWidgets / window.__generation` — internal state

Use `gDom.loadPackage`, `gDom.loadDynamicComponent`, and `gDom.onVisible` instead.
