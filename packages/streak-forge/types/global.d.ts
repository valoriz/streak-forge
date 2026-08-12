export {};

declare global {
  interface GDom extends Window {
    loadDynamicComponent: (id: string, callback: (component: HTMLElement) => void) => void;
    document: Document;
    loadPackage: (name: string) => Promise<any>;
  }

  interface StreakSitemapItem {
    url: string;
    renderConfig?: Record<string, any>;
  }
}
