import fs from "fs/promises"
import path from "path"
import glob from "fast-glob"
import matter from "gray-matter"

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

const DOCS_DIR = "docs"
const DIST_DIR = "dist"

// Edit this array to control sidebar group order.
const NAV_ORDER = [
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
]

interface PageMeta {
  file: string
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

function fileToUrl(file: string) {
  return "/" + file.replace(/^docs\//, "").replace(/\.mdx$/, ".html")
}

async function collectPages(): Promise<PageMeta[]> {
  const files = await glob(`${DOCS_DIR}/**/*.mdx`)
  const pages: PageMeta[] = []

  for (const file of files) {
    const raw = await fs.readFile(file, "utf8")
    const { data } = matter(raw)
    const relPath = file.replace(/^docs\//, "")
    const folder = relPath.includes("/") ? (relPath.split("/")[0] ?? "") : ""
    pages.push({
      file,
      url: fileToUrl(file),
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

function generateSidebar(pages: PageMeta[], currentUrl: string) {
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
    const ai = NAV_ORDER.indexOf(a)
    const bi = NAV_ORDER.indexOf(b)
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

function generateBreadcrumbs(page: PageMeta) {
  let html = `<a href="/index.html">Home</a>`
  if (page.folder) {
    const label = page.folder.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    html += `<span class="breadcrumb-sep">/</span>`
    html += `<span class="breadcrumb-section">${label}</span>`
  }
  if (page.url !== "/index.html") {
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

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/§/g, "").replace(/\s+/g, " ").trim()
}


export async function build({ minify = false } = {}) {
  const pages = await collectPages()
  const layout = await fs.readFile("templates/layout.html", "utf8")

  const searchIndex: { url: string; title: string; section: string; headings: string[]; excerpt: string }[] = []

  for (const page of pages) {
    const raw = await fs.readFile(page.file, "utf8")
    const { content, data } = matter(raw)
    const { html, toc } = await mdxToHtml(content)

    const sidebar = generateSidebar(pages, page.url)
    const breadcrumbs = generateBreadcrumbs(page)
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
      .replace("{{edit_url}}", page.file)

    if (minify) out = minifyHtml(out)

    const outFile = path.join(DIST_DIR, page.url)
    await fs.mkdir(path.dirname(outFile), { recursive: true })
    await fs.writeFile(outFile, out)
  }

  // Write search index
  await fs.writeFile(
    path.join(DIST_DIR, "search-index.json"),
    JSON.stringify(searchIndex)
  )

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

  console.log(`[build] ${pages.length} page(s) built${minify ? " (minified)" : ""}`)
}

if (import.meta.main) {
  build({ minify: true })
}
