# streak-forge

**The build engine and CLI for [Streak.js](https://docs.streakjs.com/) — a performance-first static site generator that ships zero framework overhead to the browser.**

[![npm version](https://img.shields.io/npm/v/streak-forge)](https://www.npmjs.com/package/streak-forge)
[![docs](https://img.shields.io/badge/docs-docs.streakjs.com-blue)](https://docs.streakjs.com/)
[![license](https://img.shields.io/badge/license-Apache%202.0-green)](./LICENSE)

---

## What is Streak.js?

Streak.js is a static site generator that pre-renders every page to plain HTML at build time. The only thing delivered to the browser is the generated HTML and a tiny client-side runtime that enables progressive features (lazy-loaded widgets, dynamic components, third-party JS loading) — no framework runtime, no virtual DOM, no hydration.

Pages are built from TSX components using Streak's own minimal JSX runtime — there is no React dependency anywhere in the rendered output or the runtime. Components are build-time templates only; no hooks, no client-side re-rendering.

**What Streak is NOT:**
- No hydration — output is complete static HTML
- No virtual DOM in the browser — DOM mutations use plain JS in `Script` functions
- No routing — handled by the web server, or by an optional `Middleware.ts` you provide
- No state management — widgets are pure render functions
- No CSS-in-JS — styling is collected and shipped as plain CSS

---

## Install

```bash
bun add streak-forge
```

## CLI

```bash
streak-forge dev         # local dev server with hot reload
streak-forge validate    # check for <Script> closure leaks
streak-forge pre-build   # optional: bundle source into a cache for faster builds
streak-forge build       # render every page, write raw-content.json per page
```

## Core Concepts

- **`streak.sitemap.json`** — declares every page: its layout, data handler, and widgets
- **Data handlers** (`src/handlers/*.ts`) — async functions, `(metadata, { common }) => {...}`, one per page
- **`CommonHandler.ts`** (optional, reserved filename) — shared data fetched once per build (or fresh per dev request), available to every other handler as `common`
- **`Middleware.ts`** (optional, reserved filename) — runs first on every page resolution; can override which render config is used for a URL, enabling dynamic routes not listed in the sitemap
- **Layouts** (`src/layouts/*.tsx`) — full HTML documents with `WidgetPlaceholder` slots
- **Widgets** (`src/widgets/*.tsx`) — stateless components rendered per page
- **`streak-forge/components`** — `Dynamic`, `Preload`, `Script`, `WidgetPlaceholder`

---

## Deployment

`streak-forge build` produces an intermediate `raw-content.json` snapshot per page. Taking that output live is handled by **Nexus**, the Streak cloud build and deployment system.

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
- [Common Handler](https://docs.streakjs.com/core-concepts/common-handler.html)
- [Middleware](https://docs.streakjs.com/core-concepts/middleware.html)
- [Layouts](https://docs.streakjs.com/core-concepts/layouts.html)
- [Widgets](https://docs.streakjs.com/core-concepts/widgets.html)
- [Rendering Pipeline](https://docs.streakjs.com/core-concepts/rendering-pipeline.html)
- [Loading Strategies](https://docs.streakjs.com/runtime/loading-strategies.html)
- [gDom API](https://docs.streakjs.com/runtime/gdom-api.html)
- [CLI Reference](https://docs.streakjs.com/cli/streak-forge.html)
- [Publishing](https://docs.streakjs.com/deployment/publishing.html)

---

## License

Licensed under the **Apache License, Version 2.0**.

Copyright 2026 [Valoriz Digital](https://valoriz.com/)

You may use, reproduce, modify, and distribute this software under the terms of the Apache 2.0 license. See the [LICENSE](./LICENSE) file for the full license text, or visit [apache.org/licenses/LICENSE-2.0](https://www.apache.org/licenses/LICENSE-2.0).

---

Built and maintained by [Valoriz Digital](https://valoriz.com/) — [npm org](https://www.npmjs.com/settings/valoriz_digital) · [GitHub](https://github.com/valoriz/hello-streak-app) · [Docs](https://docs.streakjs.com/)
