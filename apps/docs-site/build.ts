import fs from "fs/promises"
import path from "path"
import { execSync } from "child_process"
import glob from "fast-glob"
import matter from "gray-matter"

// The branch the "Edit this page on GitHub" links point at. CI sets
// DOCS_EDIT_BRANCH to the branch the deploy was built from (github.ref_name),
// so an edit link always targets the same branch whose content is live. Local
// builds fall back to the current git branch, then to "develop".
const EDIT_BRANCH = (() => {
  if (process.env.DOCS_EDIT_BRANCH) return process.env.DOCS_EDIT_BRANCH
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim()
  } catch {
    return "develop"
  }
})()

import { unified } from "unified"
import remarkParse from "remark-parse"
import remarkMdx from "remark-mdx"
import remarkGfm from "remark-gfm"
import remarkRehype from "remark-rehype"
import rehypeStringify from "rehype-stringify"
import rehypeShiki from "@shikijs/rehype"
import rehypeSlug from "rehype-slug"
import rehypeAutolinkHeadings from "rehype-autolink-headings"
import type { Root } from "hast"

const DIST_DIR = "dist"

// ── Versions ────────────────────────────────────────────────────────────
// Each version is its own docs folder, served under its own URL base, with
// its own sidebar, prev/next chain and search index. The default version
// keeps the site's original URLs (no prefix).
interface DocsVersion {
  id: string
  label: string
  /** Shown next to the label in the version selector, e.g. "beta". */
  badge?: string
  /** Source folder of the version's .mdx files. */
  dir: string
  /** URL prefix ("" = site root). */
  base: string
  /** Sidebar group order (folder names). */
  navOrder: string[]
  /** One-line notice shown above every page of the version (HTML). */
  banner?: string
}

const VERSIONS: DocsVersion[] = [
  {
    id: "v4",
    label: "v4",
    dir: "docs",
    base: "",
    navOrder: [
      "getting-started",
      "core-concepts",
      "components",
      "runtime",
      "assets",
      "cli",
      "deployment",
      "guides",
      "reference",
      "miscellaneous",
    ],
  },
  {
    id: "v5",
    label: "v5",
    badge: "beta",
    dir: "docs-v5",
    base: "/v5",
    navOrder: [
      "getting-started",
      "core-concepts",
      "components",
      "styling",
      "runtime",
      "cli",
      "build-platform",
      "migration",
      "reference",
    ],
    banner:
      'You are reading the <strong>v5 (beta)</strong> docs. APIs may still change before the stable release. <a href="/index.html">v4 docs</a> · <a href="/v5/migration/from-v4.html">Migrating from v4</a>',
  },
]

interface PageMeta {
  file: string
  /** Path inside the version, e.g. "core-concepts/widgets.html". */
  rel: string
  url: string
  title: string
  description: string
  section: string
  order: number
  folder: string
}

interface TocEntry {
  id: string
  text: string
  level: number
}

interface MdxResult {
  html: string
  toc: TocEntry[]
}

// ── Rehype plugin: extract TOC from h2/h3 headings ──────────────────────
function rehypeExtractToc() {
  return (tree: Root, file: any) => {
    const toc: TocEntry[] = []
    visit(tree, (node: any) => {
      if (node.type === "element" && (node.tagName === "h2" || node.tagName === "h3")) {
        const id = node.properties?.id
        if (!id) return
        // Skip anchor elements (class="heading-anchor") when extracting text
        const text = getTextContentFiltered(node)
        if (text) {
          toc.push({ id, text, level: node.tagName === "h2" ? 2 : 3 })
        }
      }
    })
    file.data.toc = toc
  }
}

// ── Rehype plugin: detect callout blockquotes ───────────────────────────
function rehypeCallouts() {
  return (tree: Root) => {
    visit(tree, (node: any) => {
      if (node.type === "element" && node.tagName === "blockquote") {
        const text = getTextContent(node)
        const match = text.match(/^\s*\*{0,2}(Note|Warning|Tip|Danger|Info):?\*{0,2}/i)
        if (match) {
          const type = match[1]!.toLowerCase()
          node.properties = node.properties || {}
          node.properties["data-callout"] = type
        }
      }
    })
  }
}

// ── Tree walker ─────────────────────────────────────────────────────────
function visit(node: any, fn: (node: any) => void) {
  fn(node)
  if (node.children) {
    for (const child of node.children) {
      visit(child, fn)
    }
  }
}

function getTextContent(node: any): string {
  if (node.type === "text") return node.value ?? ""
  if (node.children) return node.children.map(getTextContent).join("")
  return ""
}

function getTextContentFiltered(node: any): string {
  if (node.type === "text") return node.value ?? ""
  // Skip heading-anchor elements
  if (node.type === "element" && node.properties?.className?.includes?.("heading-anchor")) return ""
  if (node.children) return node.children.map(getTextContentFiltered).join("")
  return ""
}

// ── MDX → HTML pipeline ─────────────────────────────────────────────────
async function mdxToHtml(source: string): Promise<MdxResult> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkMdx)
    .use(remarkGfm)
    .use(remarkRehype)
    .use(rehypeSlug)
    .use(rehypeAutolinkHeadings, {
      behavior: "prepend",
      properties: { className: ["heading-anchor"], ariaHidden: true, tabIndex: -1 },
      content: {
        type: "element",
        tagName: "span",
        properties: { className: ["heading-anchor-icon"] },
        children: [{
          type: "element",
          tagName: "svg",
          properties: {
            xmlns: "http://www.w3.org/2000/svg",
            width: "0.75em",
            height: "0.75em",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2.5",
            strokeLinecap: "round",
            strokeLinejoin: "round",
          },
          children: [
            { type: "element", tagName: "path", properties: { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }, children: [] },
            { type: "element", tagName: "path", properties: { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }, children: [] },
          ],
        }],
      },
    })
    .use(rehypeShiki, {
      themes: {
        light: "github-light",
        dark: "github-dark",
      },
      defaultColor: false,
    })
    .use(rehypeCallouts)
    .use(rehypeExtractToc)
    .use(rehypeStringify)
    .process(source)

  return {
    html: String(file),
    toc: (file.data.toc as TocEntry[]) ?? [],
  }
}

function minifyHtml(html: string) {
  const preserved: string[] = []

  html = html.replace(/(<(?:pre|script|style)\b[^>]*>[\s\S]*?<\/(?:pre|script|style)>)/gi, (match) => {
    preserved.push(match)
    return `\x00PRESERVED_${preserved.length - 1}\x00`
  })

  html = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim()

  html = html.replace(/\x00PRESERVED_(\d+)\x00/g, (_, i) => preserved[parseInt(i)] ?? "")

  return html
}

async function collectPages(version: DocsVersion): Promise<PageMeta[]> {
  const files = await glob(`${version.dir}/**/*.mdx`)
  const pages: PageMeta[] = []

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8")
    const { data } = matter(raw)
    const relPath = file.slice(version.dir.length + 1)
    const folder = relPath.includes("/") ? (relPath.split("/")[0] ?? "") : ""
    const rel = relPath.replace(/\.mdx$/, ".html")
    pages.push({
      file,
      rel,
      url: `${version.base}/${rel}`,
      title: data.title ?? path.basename(file, ".mdx"),
      description: data.description ?? "",
      section: data.section ?? "",
      order: typeof data.order === "number" ? data.order : 999,
      folder,
    })
  }

  pages.sort((a, b) => {
    if (a.folder < b.folder) return -1
    if (a.folder > b.folder) return 1
    return a.order - b.order
  })

  return pages
}

function generateSidebar(pages: PageMeta[], currentUrl: string, navOrder: string[]) {
  const groups = new Map<string, PageMeta[]>()
  for (const page of pages) {
    if (!groups.has(page.folder)) groups.set(page.folder, [])
    groups.get(page.folder)!.push(page)
  }

  let html = ""

  for (const item of groups.get("") ?? []) {
    const active = item.url === currentUrl ? " active" : ""
    html += `<a class="sidebar-link${active}" href="${item.url}">${item.title}</a>`
  }

  const sortedFolders = [...groups.keys()].filter(f => f).sort((a, b) => {
    const ai = navOrder.indexOf(a)
    const bi = navOrder.indexOf(b)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.localeCompare(b)
  })

  for (const folder of sortedFolders) {
    const items = groups.get(folder)!
    const isOpen = items.some(item => item.url === currentUrl)
    const label = folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    html += `<details class="sidebar-group"${isOpen ? " open" : ""}>`
    html += `<summary class="sidebar-group-label">${label}</summary>`
    html += `<div class="sidebar-group-items">`
    for (const item of items) {
      const active = item.url === currentUrl ? " active" : ""
      html += `<a class="sidebar-link${active}" href="${item.url}">${item.title}</a>`
    }
    html += `</div></details>`
  }

  return html
}

function generateBreadcrumbs(page: PageMeta, version: DocsVersion) {
  let html = `<a href="${version.base}/index.html">Home</a>`
  if (page.folder) {
    const label = page.folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    html += `<span class="breadcrumb-sep">/</span>`
    html += `<span class="breadcrumb-section">${label}</span>`
  }
  if (page.rel !== "index.html") {
    html += `<span class="breadcrumb-sep">/</span>`
    html += `<span class="breadcrumb-current">${page.title}</span>`
  }
  return html
}

function generateTocHtml(toc: TocEntry[]) {
  if (toc.length === 0) return ""
  let html = ""
  for (const entry of toc) {
    const indent = entry.level === 3 ? " toc-h3" : ""
    html += `<a class="toc-link${indent}" href="#${entry.id}">${entry.text}</a>`
  }
  return html
}

function generatePageNav(pages: PageMeta[], currentUrl: string) {
  const idx = pages.findIndex(p => p.url === currentUrl)

  let prev = ""
  let next = ""

  const prevPage = idx > 0 ? pages[idx - 1] : undefined
  const nextPage = idx < pages.length - 1 ? pages[idx + 1] : undefined

  if (prevPage) {
    prev = `<a class="page-nav-prev" href="${prevPage.url}">
      <span class="page-nav-label">← Previous</span>
      <span class="page-nav-title">${prevPage.title}</span>
    </a>`
  }

  if (nextPage) {
    next = `<a class="page-nav-next" href="${nextPage.url}">
      <span class="page-nav-label">Next →</span>
      <span class="page-nav-title">${nextPage.title}</span>
    </a>`
  }

  return { prev, next }
}

/** Version selector: each option links to the same page in that version
 *  when it exists there, else to that version's home page. */
function generateVersionSwitcher(current: DocsVersion, page: PageMeta, relsByVersion: Map<string, Set<string>>) {
  const options = VERSIONS.map((v) => {
    const target = relsByVersion.get(v.id)?.has(page.rel) ? page.rel : "index.html"
    const label = v.badge ? `${v.label} (${v.badge})` : v.label
    const selected = v.id === current.id ? " selected" : ""
    return `<option value="${v.base}/${target}"${selected}>${label}</option>`
  }).join("")
  return `<label class="version-switcher" title="Documentation version">
      <span class="visually-hidden">Documentation version</span>
      <select class="version-select" onchange="location.href=this.value" aria-label="Documentation version">${options}</select>
    </label>`
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/§/g, "").replace(/\s+/g, " ").trim()
}


export async function build({ minify = false } = {}) {
  const layout = await fs.readFile("templates/layout.html", "utf8")
  const pagesByVersion = new Map<string, PageMeta[]>()
  for (const version of VERSIONS) pagesByVersion.set(version.id, await collectPages(version))
  const relsByVersion = new Map(
    [...pagesByVersion].map(([id, pages]) => [id, new Set(pages.map((p) => p.rel))]),
  )
  let total = 0

  for (const version of VERSIONS) {
    const pages = pagesByVersion.get(version.id)!
    total += pages.length
    const searchIndex: { url: string; title: string; section: string; headings: string[]; excerpt: string }[] = []

    for (const page of pages) {
      const raw = await fs.readFile(page.file, "utf8")
      const { content, data } = matter(raw)
      const { html, toc } = await mdxToHtml(content)

      const sidebar = generateSidebar(pages, page.url, version.navOrder)
      const breadcrumbs = generateBreadcrumbs(page, version)
      const tocHtml = generateTocHtml(toc)
      const { prev, next } = generatePageNav(pages, page.url)
      const description = data.description ?? ""

      // Build search index entry
      const plainText = stripHtml(html)
      searchIndex.push({
        url: page.url,
        title: page.title,
        section: page.folder ? page.folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "",
        headings: toc.map(t => t.text),
        excerpt: plainText.slice(0, 200),
      })

      const pageTitle = `${data.title ?? "Docs"} — Streak.js`
      let out = layout
        .replaceAll("{{title}}", pageTitle)
        .replaceAll("{{description}}", description)
        .replace("{{content}}", html)
        .replace("{{sidebar}}", sidebar)
        .replace("{{breadcrumbs}}", breadcrumbs)
        .replace("{{toc}}", tocHtml)
        .replace("{{prev}}", prev)
        .replace("{{next}}", next)
        .replaceAll("{{edit_branch}}", EDIT_BRANCH)
        .replace("{{edit_url}}", page.file)
        .replace("{{version_switcher}}", generateVersionSwitcher(version, page, relsByVersion))
        .replace("{{version_banner}}", version.banner ? `<div class="version-banner">${version.banner}</div>` : "")
        .replaceAll("{{version_base}}", version.base)

      if (minify) out = minifyHtml(out)

      const outFile = path.join(DIST_DIR, page.url)
      await fs.mkdir(path.dirname(outFile), { recursive: true })
      await fs.writeFile(outFile, out)
    }

    // Search index, one per version (the layout fetches {{version_base}}/search-index.json)
    await fs.mkdir(path.join(DIST_DIR, version.base), { recursive: true })
    await fs.writeFile(
      path.join(DIST_DIR, version.base, "search-index.json"),
      JSON.stringify(searchIndex)
    )
  }

  // Copy static assets
  await fs.mkdir(DIST_DIR, { recursive: true })
  await fs.copyFile("templates/styles.css", `${DIST_DIR}/styles.css`)
  await fs.copyFile("icons/favicon.png", `${DIST_DIR}/favicon.png`).catch(() => {
    console.warn("[build] no favicon.png found in icons/, skipping")
  })
  await fs.copyFile("icons/streak-logo-light-mode.svg", `${DIST_DIR}/streak-logo-light-mode.svg`).catch(() => {
    console.warn("[build] no streak-logo-light-mode.svg found in icons/, skipping")
  })
  await fs.copyFile("icons/streak-logo-dark-mode.svg", `${DIST_DIR}/streak-logo-dark-mode.svg`).catch(() => {
    console.warn("[build] no streak-logo-dark-mode.svg found in icons/, skipping")
  })

  console.log(`[build] ${total} page(s) built across ${VERSIONS.length} version(s)${minify ? " (minified)" : ""}`)
}

if (import.meta.main) {
  build({ minify: true })
}
