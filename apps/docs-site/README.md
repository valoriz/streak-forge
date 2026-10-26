# docs-site

The Streak.js documentation site: MDX pages built to static HTML by `build.ts`.

```bash
bun install
bun run dev     # build, watch, serve on http://localhost:3000
bun run build   # minified build into dist/
```

## Versions

Each docs version is its own folder, listed in `VERSIONS` in `build.ts`:

| Version | Folder | URL base | Notes |
|---|---|---|---|
| v4 | `docs/` | `/` | Default; keeps the site's original URLs |
| v5 | `docs-v5/` | `/v5/` | Marked "beta" in the selector; shows a beta banner on every page |

Every version gets its own sidebar (group order from its `navOrder`), prev/next chain and search index (`<base>/search-index.json`). The version selector in the top bar links to the same page in the other version when a file with the same path exists there, else to that version's home page.

Links inside a version's pages must include its base, e.g. `/v5/core-concepts/slots.html`.

To add a version: create its folder, add an entry to `VERSIONS` (`id`, `label`, optional `badge`, `dir`, `base`, `navOrder`, optional `banner`), and add the folder to the watch list in `dev.ts`.

## Pages

Each `.mdx` file has frontmatter `title`, `description` and `order` (sort order within its folder). The first folder level is the sidebar group. Blockquotes starting with `**Note:**`, `**Tip:**`, `**Warning:**`, `**Danger:**` or `**Info:**` render as callouts.
