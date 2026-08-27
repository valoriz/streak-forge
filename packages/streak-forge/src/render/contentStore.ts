import type { ScriptItem } from "../types";

export interface StoredContent {
  id: string;
  html: string;
  scripts: ScriptItem[];
}

// Lazy widgets and <Dynamic> blocks are fetched by the browser as a separate
// request after the initial page load. Whatever a page render produces for
// them is kept here (keyed by page url) until that fetch arrives. Dev-only:
// no TTL/eviction, repopulated fresh on every full page render.
const store = new Map<string, StoredContent>();

const key = (pageUrl: string, type: string, id: string) =>
  `${pageUrl}|${type}|${id}`;

export const putContent = (
  pageUrl: string,
  type: string,
  content: StoredContent,
) => {
  store.set(key(pageUrl, type, content.id), content);
};

export const getContent = (
  pageUrl: string,
  type: string,
  id: string,
): StoredContent | undefined => {
  return store.get(key(pageUrl, type, id));
};
