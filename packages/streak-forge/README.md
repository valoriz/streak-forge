# streak-forge

**The build engine and CLI for [Streak.js](https://docs.streakjs.com/) — a performance-first static site generator that ships zero framework overhead to the browser.**

[![npm version](https://img.shields.io/npm/v/streak-forge)](https://www.npmjs.com/package/streak-forge)
[![docs](https://img.shields.io/badge/docs-docs.streakjs.com-blue)](https://docs.streakjs.com/)
[![license](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)

---

## What is Streak.js?

Streak.js is a static site generator that pre-renders every page to plain HTML at build time. The only thing delivered to the browser is the generated HTML and a tiny client-side coordinator (`app.js`) — no framework runtime, no virtual DOM, no hydration.

TSX components are used as **build-time templates only**. Once the HTML is written, React is gone. A minimal runtime enables progressive features like lazy-loaded widgets, dynamic components, and on-demand JS loading — but it never re-renders anything.

**What Streak is NOT:**
- No hydration — output is complete static HTML
- No virtual DOM in the browser — DOM mutations use plain JS in `Script` functions
- No routing — handled by the web server (Netlify, nginx, etc.)
- No state management — widgets are pure render functions
- No CSS-in-JS — all styling is Tailwind compiled at build time
- No code splitting — one HTML file per page, JS loaded progressively

---

## How It Works

```
streak.sitemap.json
{ url, renderId, dataHandler, rootLayout, widgets[] }
         │
         ├── DataHandler (async fn)  →  returns { status: 200, WidgetId: { ... } }
         │
         └── Layout (TSX)           →  full HTML with WidgetPlaceholders

                         ↓ Streak Renderer ↓

         For each widget in widgets[]:
           1. find src/widgets/<type>.tsx
           2. render TSX with { data: handlerData[id] }
           3. replace WidgetPlaceholder in layout HTML

                         ↓ Output ↓

         out/<renderId>/index.html
         ─────────────────────────
         Complete static HTML
         + <script id="w-m">{json}</script>   ← widget registry
         + <script>app.js IIFE</script>        ← client coordinator
         + inline Script widgets               ← each Script component
```

---

## Installation

`streak-forge` is the CLI and build engine. Add it to your Streak.js project:

```bash
bun add streak-forge
```

**Prerequisites:** [Bun](https://bun.sh) >= 1.0

---

## Quick Start

Clone the [hello-streak-app](https://github.com/valoriz/hello-streak-app) starter and install dependencies:

```bash
git clone https://github.com/valoriz/hello-streak-app.git my-app
cd my-app
bun install
```

Start the dev server:

```bash
bun run dev
# → http://localhost:3690
```

See the [full getting-started guide](https://docs.streakjs.com/getting-started/hello-streak-app.html) for a step-by-step walkthrough.

---

## CLI Commands

### `streak-forge dev`

Starts a development server on port **3690** with hot-reload. Pages are rendered on request — nothing is written to disk.

```bash
streak-forge dev
```

### `streak-forge pre-build`

Reads `streak.sitemap.json`, runs every page through the 7-stage rendering pipeline, and writes static HTML to `out/`.

```bash
streak-forge pre-build
```

Output structure:
```
out/
  homeRenderId/
    index.html
  aboutRenderId/
    index.html
```

### Typical `package.json` scripts

```json
{
  "scripts": {
    "dev":        "concurrently \"bun run css-dev\" \"bun run dev:streak\"",
    "dev:streak": "streak-forge dev",
    "build":      "bun run css-build && streak-forge pre-build",
    "css-build":  "tailwindcss -i ./src/common/styles/input.css -o ./public/styles/tailwind.css",
    "css-dev":    "tailwindcss -i ./src/common/styles/input.css -o ./public/styles/tailwind.css --watch"
  }
}
```

---

## Project Structure

```
my-streak-site/
  src/
    handlers/         ← async data providers (one per page)
    layouts/          ← full HTML document templates with WidgetPlaceholders
    widgets/          ← stateless TSX components rendered at build time
  public/
    assets/           ← JS/CSS loaded at runtime via the asset worker
    styles/           ← compiled Tailwind CSS
  out/                ← generated static output (created by build)
  streak.sitemap.json
  tsconfig.json
  package.json
```

---

## Core Concepts

### Sitemap — `streak.sitemap.json`

The single entry point for the entire build. Every page, its layout, data source, and widget list is declared here.

```json
[
  {
    "url": "/",
    "renderConfig": {
      "renderId": "homeRenderId",
      "dataHandler": "HomeDataHandler",
      "rootLayout": "MainLayout",
      "widgets": [
        { "id": "PageHead",     "type": "PageHead" },
        { "id": "HeroBanner",   "type": "HeroBanner" },
        { "id": "Footer",       "type": "Footer", "loadingStrategy": "lazy" }
      ],
      "version": "1.0.0"
    }
  }
]
```

| Field | Description |
|---|---|
| `url` | The URL path for this page |
| `renderId` | Unique ID; becomes the output folder name inside `out/` |
| `dataHandler` | Filename (no extension) of the handler in `src/handlers/` |
| `rootLayout` | Filename (no extension) of the layout in `src/layouts/` |
| `widgets[]` | Ordered list of widgets to render on this page |
| `loadingStrategy` | `"lazy"` to defer widget JS until after page is interactive |

---

### Data Handlers

Async functions that run before any JSX is rendered. They fetch data and return a plain object whose keys match widget ids.

```ts
// src/handlers/HomeDataHandler.ts
const getHomeData = async () => {
  const posts = await fetch("https://cms.example.com/api/posts").then(r => r.json());

  return {
    status: 200,           // required — signals render success
    PageHead: {
      title: "Home",
    },
    HeroBanner: {
      heading: "Welcome",
      posts,
    },
  };
};

export default getHomeData;
```

- Must be the **default export**
- Must return `{ status: 200, ...widgetData }`
- Each top-level key (except `status`) must match a widget `id` in the sitemap
- Fully async — `await` any API, CMS, or database call here

---

### Layouts

TSX components that return the **full HTML document**. They contain no business logic — only structure and `WidgetPlaceholder` slots.

```tsx
// src/layouts/MainLayout.tsx
import { WidgetPlaceholder } from "streak/components";

const MainLayout = () => (
  <html lang="en">
    <head>
      <WidgetPlaceholder id="PageHead" type="PageHead" />
    </head>
    <body>
      <WidgetPlaceholder id="NavBar"     type="NavBar"     />
      <WidgetPlaceholder id="HeroBanner" type="HeroBanner" />
      <WidgetPlaceholder id="Footer"     type="Footer"     />
    </body>
  </html>
);

export default MainLayout;
```

At build time, each `WidgetPlaceholder` is replaced with the fully rendered HTML of the matching widget.

---

### Widgets

Stateless TSX components rendered once at build time. They receive handler data as `props.data` and return a section of page HTML.

```tsx
// src/widgets/HeroBanner.tsx
type HeroBannerProps = {
  data?: {
    heading?: string;
  };
};

const HeroBanner = (props: HeroBannerProps) => (
  <section class="hero">
    <h1>{props?.data?.heading ?? "Welcome"}</h1>
  </section>
);

export default HeroBanner;
```

**Rules:**
- Filename must exactly match the `type` in the sitemap (case-sensitive)
- Must be the **default export**
- Data arrives as `props.data` — always use `?.` and `??` as data can be `undefined`
- No `useState`, no `useEffect` — widgets are pure build-time functions
- Client-side interactivity lives in `<Script>` components inside the widget

---

### Adding Client-Side Behavior with `<Script>`

The `Script` component serializes a function to a string at build time and runs it as an IIFE in the browser. The first argument is `gDom` — `window` extended with Streak's runtime helpers.

```tsx
import { Script } from "streak/components";

const HeroBanner = (props: HeroBannerProps) => (
  <section>
    <h1 id="hero-heading">{props?.data?.heading ?? "Welcome"}</h1>
    <Script id="hero-script" options={{ color: "#818cf8" }}>
      {(gDom: any, options: any) => {
        gDom.geById("hero-heading").style.color = options.color;
      }}
    </Script>
  </section>
);
```

---

### Loading Strategies

| Strategy | HTML in initial payload | JS loaded | Best for |
|---|---|---|---|
| Default (no `loadingStrategy`) | Yes | Immediately | Hero, nav, above-the-fold |
| `"lazy"` | Yes | After page is interactive | Footer, below-fold sections |
| `<Dynamic>` component | No | On demand via `loadDynamicComponent()` | Modals, menus, overlays |

---

### Runtime API (gDom)

Inside `Script` functions, `gDom` is `window` extended with:

| Method | Description |
|---|---|
| `gDom.ftr` | `true` on user's first visit (30-min session) |
| `gDom.loadPackage(path)` | Loads a JS/CSS file from `public/assets/` via the asset worker |
| `gDom.loadDynamicComponent(id, cb)` | Injects a `<Dynamic>` component's HTML on demand |
| `gDom.onVisible(el, cb)` | `IntersectionObserver` wrapper — fires `cb` when `el` enters viewport |
| `gDom.debounce(fn, delay)` | Returns a debounced version of `fn` |
| `gDom.geById(id)` | Shorthand for `document.getElementById` |
| `gDom.stall(ms)` | `Promise` that resolves after `ms` milliseconds |
| `gDom.setCookie(name, value, days)` | Sets a browser cookie |
| `gDom.getCookie(name)` | Reads a browser cookie |

Load third-party libraries via the asset worker:

```ts
await gDom.loadPackage("js/motion.js");
const { animate, scroll } = gDom.Motion;

await gDom.loadPackage("js/lenis.min.js");
const lenis = new gDom.Lenis();
```

---

## The 7-Stage Rendering Pipeline

When `streak-forge pre-build` runs, each sitemap entry passes through:

| Stage | Name | Description |
|---|---|---|
| 1 | `validateStreakConfig` | Validates the sitemap entry structure |
| 2 | `pageDataHandler` | Calls the async data handler |
| 3 | `renderRootLayout` | Renders the layout JSX to an HTML string |
| 4 | `renderWidgets` | Renders each widget and injects into the layout |
| 5 | `pageBuildAndOptimize` | Optimizes the output (build only) |
| 6 | `prepareStyle` | Embeds or links CSS (build only) |
| 7 | `prepareRawForBuild` | Writes `out/<renderId>/index.html` (build only) |

In dev mode, stages 5–7 are replaced with hot-reload variants that serve over HTTP without writing to disk.

---

## Configuration

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "baseUrl": "src/",
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "types": ["bun-types"]
  },
  "include": ["src/**/*"]
}
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `"development"` | Set to `"production"` for production builds |
| `PORT` | `3690` | Dev server port |
| `STATIC_BUILD_DIR` | `"out"` | Output directory for `pre-build` |
| `TARGET_SRC` | `"src"` | Root directory for handlers, layouts, and widgets |

---

## Deployment

Production builds are handled by **Nexus** — the Streak cloud build and deployment system. When you publish through Nexus, it runs the build pipeline and deploys the output automatically. Local `bun run build` is used for testing; Nexus runs it for production.

> Refer to the [Nexus documentation](https://nexusoneonline.com/) for publishing and deployment details.

---

## Full Documentation

Complete documentation is available at **[docs.streakjs.com](https://docs.streakjs.com/)**.

- [Introduction](https://docs.streakjs.com/introduction.html)
- [Quick Start](https://docs.streakjs.com/quick-start.html)
- [Installation](https://docs.streakjs.com/getting-started/installation.html)
- [Project Structure](https://docs.streakjs.com/getting-started/project-structure.html)
- [Configuration](https://docs.streakjs.com/getting-started/configuration.html)
- [Sitemap](https://docs.streakjs.com/core-concepts/sitemap.html)
- [Data Handlers](https://docs.streakjs.com/core-concepts/data-handlers.html)
- [Layouts](https://docs.streakjs.com/core-concepts/layouts.html)
- [Widgets](https://docs.streakjs.com/core-concepts/widgets.html)
- [Rendering Pipeline](https://docs.streakjs.com/core-concepts/rendering-pipeline.html)
- [Loading Strategies](https://docs.streakjs.com/runtime/loading-strategies.html)
- [GDOM API](https://docs.streakjs.com/runtime/gdom-api.html)
- [CLI Reference](https://docs.streakjs.com/cli/streak-forge.html)
- [Deployment](https://docs.streakjs.com/deployment/static-hosting.html)

---

## License

Licensed under the **Apache License, Version 2.0**.

Copyright 2026 [Valoriz Digital](https://valoriz.com/)

You may use, reproduce, modify, and distribute this software under the terms of the Apache 2.0 license. See the [LICENSE](./LICENSE) file for the full license text, or visit [apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0).

---

Built and maintained by [Valoriz Digital](https://valoriz.com/) — [npm org](https://www.npmjs.com/settings/valoriz_digital) · [GitHub](https://github.com/valoriz/hello-streak-app) · [Docs](https://docs.streakjs.com/)
