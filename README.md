# streak-forge

Streak.js framework and static site generator for building fast, modern websites — the core build engine/CLI, project scaffolding, and documentation site.

## What is Streak Forge?

Streak.js pre-renders every page to plain HTML at build time. `streak-forge` is the rendering engine and CLI that powers that build; `create-streak-app` scaffolds new projects from a starter template; the docs site documents both.

## Why Split the Monorepo

- Separate **public framework** from **private platform code**
- Independent development and releases
- Simpler CI/CD and testing
- Better security and access control
- Clear ownership for each product

## Repository Contents

```
streak-forge/
├── packages/
│   ├── streak-forge        # core build engine + CLI (npm: streak-forge)
│   └── create-streak-app   # project scaffolding CLI (npm: create-streak-app)
├── apps/
│   └── docs-site           # documentation site (docs.streakjs.com)
└── package.json            # workspace root
```

`create-streak-app` scaffolds a new project and installs the published `streak-forge` package from npm — it does not depend on this repo's local source at runtime.

This repository does **not** contain `streak-distiller`, the legacy `streakjs` package, or the internal build/infra apps (`streak-forge-build`, `streak-forge-local-runner`, `build-preview-server`). Those remain in separate, private repositories.

## Requirements

- [Bun](https://bun.sh) >= 1.0

## Install

```bash
bun install
```

## Build

Build everything:

```bash
bun run build
```

Or build a single workspace:

```bash
bun run build:streak-forge
bun run build:create-streak-app
bun run build:docs-site
```

## Test

```bash
bun run test
```

`create-streak-app` currently has no automated tests configured (`packages/create-streak-app` test script is a placeholder, unchanged from the original monorepo).

## Documentation

Full framework documentation is published at **[docs.streakjs.com](https://docs.streakjs.com/)** — installation, CLI reference, core concepts (sitemap, data handlers, `CommonHandler`, `Middleware`, layouts, widgets), and the `streak-forge/components` API.

The docs site's own source lives in this repo at `apps/docs-site` (see below) if you're contributing to the documentation itself.

## Deployment (Private)

`streak-forge build` produces an intermediate JSON snapshot locally. Turning that into a hosted, live site is handled by **Nexus**, the Streak cloud build and deployment system — internal/private tooling, not part of this repository.

> See the [Nexus documentation](https://docs.nexusoneonline.com/) for publishing and deployment details.

## Documentation Site (Contributing)

```bash
cd apps/docs-site
bun run dev     # local dev server
bun run build   # static build to dist/
```

## Using create-streak-app

```bash
bun add streak-forge      # add the framework to an existing project
# or
npx create-streak-app     # scaffold a new project from the starter template
```

`create-streak-app` clones the [hello-streak-app](https://github.com/valoriz/hello-streak-app) starter and installs the latest published `streak-forge` from npm.

## License

Apache License 2.0 — see [packages/streak-forge/LICENSE](packages/streak-forge/LICENSE).
