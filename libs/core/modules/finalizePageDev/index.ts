import type { HandlerOptions } from "@core/types";
import type { AddResourceOptions, CustomWindow, LoadedResourcesMap, UserStreakConfigOut, WidgetMetadataItem, WidgetOut, WidgetResponse } from "./types";
import { parse } from "node-html-parser";
import path from "path";
import { pageResourceTypes, publicAssets, scriptSpecificVariables } from "@core/libs/constants";
import { convertSfScriptElements } from "@core/libs/htmlUtils";

const minifyJavaScript = async (code: string) => {
  // Placeholder for actual minification logic, e.g., using Terser
  return code;
};

const validationConfiguration = {};

const getContentPath = (renderId: string) => (base: string, directoryNames: string[]) => {
  return path.join(renderId, base, ...directoryNames);
};

const getCurrentDateTime = () => Date.now().toString();

const getCoreScript = () => {
  return (
    win: CustomWindow,
    mop: {
      [key: string]: string;
    }
  ) => {
    (win as any)._s_time = new Date().getTime();
    (win as any).loadedResources = (win as any).loadedResources || ({} as LoadedResourcesMap);

    win.addResourceToBody = (src: string, options?: AddResourceOptions, callback?: Function) => {
      const loadedResources = (win as any).loadedResources as any;

      if (loadedResources[src]) {
        loadedResources[src]
          .then(() => callback && callback())
          .catch((err: Error) => {
            console.error("Failed to load resource:", src, err);
          });
        return;
      }

      const ext = src?.split("?")[0]?.split(".").pop()?.toLowerCase();

      const resourcePromise = new Promise<void>((resolve, reject) => {
        let el: HTMLElement | null = null;

        if (ext === "js") {
          const script = win.document.createElement("script");
          script.src = src;
          if (options?.async) script.async = true;
          if (options?.defer) script.defer = true;
          if (options?.attributes) {
            Object.entries(options.attributes).forEach(([k, v]) => script.setAttribute(k, v));
          }
          script.onload = () => resolve();
          script.onerror = (err) => reject(err);
          el = script;
        } else if (ext === "css") {
          const link = win.document.createElement("link");
          link.rel = "stylesheet";
          link.href = src;
          if (options?.attributes) {
            Object.entries(options.attributes).forEach(([k, v]) => link.setAttribute(k, v));
          }
          link.onload = () => resolve();
          link.onerror = (err) => reject(err);
          el = link;
        } else {
          reject(new Error(`Unsupported resource type: ${ext}`));
          return;
        }

        win.document.body.appendChild(el);
      });

      loadedResources[src] = resourcePromise;

      resourcePromise
        .then(() => callback && callback())
        .catch((err) => {
          console.error("Failed to load resource:", src, err);
          delete loadedResources[src];
        });
    };

    (win as any).loadedWidgets = (win as any).loadedWidgets || new Set<string>();
    (win as any).loadedScripts = (win as any).loadedScripts || new Set<string>();
    win.widgetMetaData = JSON.parse(win.document.getElementById(mop.wm!)?.innerHTML || "{}");

    const rfals = (str: string) => str.replace(/^\/+|\/+$/g, "");

    win.addWidgetToBody = (componentId: string, callback?: Function, type = "w") => {
      const loadedWidgets = (win as any).loadedWidgets as Set<string>;
      const loadedScripts = (win as any).loadedScripts as Set<string>;

      const isRootResource = !!componentId?.match(/(^.*\.json$)|(^.*\.(js|css)$)/);
      const version = win.widgetMetaData[type]?.v || win.widgetMetaData[type]?.find((each: { id: string }) => each?.id === componentId)?.v || "";

      if (!version) {
        if (callback) callback();
        console.error("NoV:", componentId);
        return;
      }

      const uniqueComponentId = `${type || ""}_${componentId || ""}`;
      if (loadedWidgets.has(uniqueComponentId)) {
        if (callback) callback();
        return;
      }
      const resourceUrl = `/${rfals(win.location.pathname)}/${version}/${isRootResource ? rfals(componentId) : `${type}/${rfals(componentId)}/content.json`}`;
      fetch(resourceUrl)
        .then((res) => res.json())
        .then((data: WidgetResponse) => {
          const { id: widgetId, html, scripts } = data;

          let widgetInserted = false;
          let widgetElement: Element | null = null;

          if (widgetId && !loadedWidgets.has(uniqueComponentId) && html) {
            const placeholder = win.document.querySelector(`[component-id="${widgetId}"][component-type="${type}"]`);

            if (placeholder) {
              placeholder.outerHTML = html;
              widgetInserted = true;
              widgetElement = win.document.querySelector(`[component-id="${widgetId}"]`);
              loadedWidgets.add(uniqueComponentId);
            } else if (type === "w") {
              const dynamicPlaceholder = win.document.querySelector(`[component-type="d"]`);

              if (dynamicPlaceholder) {
                const wrapper = win.document.createElement("div");
                wrapper.innerHTML = html;
                dynamicPlaceholder.parentNode?.insertBefore(wrapper.firstElementChild!, dynamicPlaceholder);
                widgetInserted = true;
                widgetElement = wrapper.firstElementChild!;
                loadedWidgets.add(uniqueComponentId);
              }
            }
          }

          if (scripts?.length) {
            scripts.forEach((script) => {
              if (!script.id || loadedScripts.has(script.id)) return;

              if (script.content) {
                const scriptEl = win.document.createElement("script");
                scriptEl.innerHTML = script.content;
                scriptEl.id = script.id;

                if (widgetInserted && widgetElement) {
                  widgetElement.insertAdjacentElement("afterend", scriptEl);
                } else {
                  win.document.body.appendChild(scriptEl);
                }
              }

              loadedScripts.add(script.id);
            });
          }

          if (callback) callback();
        })
        .catch((err) => {
          console.error("Error loading widget:", err);
        });
    };

    win[mop.wlt!] = Date.now();

    win.loadDynamicComponent = (componentId: string, callback?: Function) => win.addWidgetToBody(componentId, callback, "c");
  };
};

const handler = (options: HandlerOptions) => async (previousConfig: UserStreakConfigOut) => {
  const rootLayoutOut = previousConfig.rootLayoutOut;

  if (previousConfig.notFound) {
    const root = parse(rootLayoutOut || "<html><head></head><body></body></html>");
    const body = root.querySelector("body");
    if (body) body.innerHTML = `<p>Not Found</p>`;
    return root.toString();
  }

  const widgets: WidgetOut[] = previousConfig.widgets;
  const headerContent = previousConfig.headContent || "";
  const version = previousConfig.version || getCurrentDateTime();
  const criticalCss = previousConfig.css || "";
  const staticScripts = previousConfig.rootLayoutScripts || [];
  const dynamicComponents = previousConfig.dynamicComponents || [];

  const root = convertSfScriptElements(parse(rootLayoutOut));

  if (!root.querySelector("head")) {
    const html = root.querySelector("html");
    if (html) html.appendChild(parse("<head></head>"));
  }

  root.querySelector("head")?.appendChild(parse(`<style id="critical-css">${criticalCss || ""}</style>`));

  const head = root.querySelector("head");
  // App
  head?.appendChild(parse(`<script src="${path.join(publicAssets.ASSET_ROOT, publicAssets.APP)}" ></script>`));

  // Core script (inline)
  head?.appendChild(
    parse(
      `<script>${await minifyJavaScript(
        `window.__sy_a = ${JSON.stringify({
          awh: path.join(publicAssets.ASSET_ROOT, publicAssets.ASSET_WORKER_HANDLER),
          wp: path.join(publicAssets.ASSET_ROOT, publicAssets.ASSET_WORKER),
        })};`
      )}</script><script id="core-script">${await minifyJavaScript(
        `(${getCoreScript().toString()})(window, {wlt: "${scriptSpecificVariables.WINDOW_LOADING_TIME_ID}", wm: "${scriptSpecificVariables.WIDGET_META_DATA_ID}"});`
      )}</script>`
    )
  );

  if (headerContent) {
    root.querySelector("head")?.appendChild(parse(headerContent));
  }

  const contentToSave: {
    [key: string]: string;
  }[] = [];

  const widgetMetaData: {
    [key: string]: WidgetMetadataItem | WidgetMetadataItem[];
  } = {};

  const scriptIds = new Set<string>();

  if (staticScripts) {
    for (const script of staticScripts) {
      if (script.content && !scriptIds.has(script.id)) {
        const content = await minifyJavaScript(script.content);
        if (content) {
          root.insertAdjacentHTML(
            "beforeend",
            `<script ${script.id ? `id="${script.id}"` : ""} ${script.dependWidgetId ? `depend-widget-id="${script.dependWidgetId}"` : ""}>${content}</script>`
          );
        }
        scriptIds.add(script.id);
      }
    }
  }

  widgetMetaData.w = [];

  widgets.forEach((widget) => {
    const widgetHtml = widget.out;
    const widgetId = widget.id;
    if (widgetHtml) {
      const outRoot = convertSfScriptElements(parse(widgetHtml));

      const widgetPlaceHolder = root.querySelectorAll(`div[${scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_ID}="${widget.id}"]`)?.find((el) => {
        return el.getAttribute(scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_TYPE) === pageResourceTypes.WIDGET;
      });

      if (widgetPlaceHolder) {
        widgetPlaceHolder.replaceWith(outRoot);
      } else {
        try {
          const dynamicPlaceholder = root.querySelector(`div[${scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_TYPE}="${pageResourceTypes.DYNAMIC}"]`);
          if (dynamicPlaceholder) {
            dynamicPlaceholder.insertAdjacentHTML("beforebegin", outRoot.toString());
          }
        } catch (error) {
          console.error(error);
        }
      }

      if (widget.scriptsOut?.length) {
        widget.scriptsOut.forEach(async (script) => {
          if (script.content && !scriptIds.has(script.id)) {
            root.insertAdjacentHTML(
              "beforeend",
              `<script ${script.id ? `id="${script.id}"` : ""} ${script.dependWidgetId ? `depend-widget-id="${script.dependWidgetId}"` : ""}>${script.content}</script>`
            );
            scriptIds.add(script.id);
          }
        });
      }
    } else {
      console.warn(`Widget with id "${widgetId}" has no output HTML.`);
    }
  });

  if (Array.isArray(dynamicComponents) && dynamicComponents.length > 0) {
    widgetMetaData.c = [];
    dynamicComponents.forEach((component, index) => {
      const componentHtml = component.html;
      const componentId = component.id;
      if (componentHtml && componentId) {
        const componentPath = getContentPath(previousConfig.renderId)(version, [pageResourceTypes.COMPONENT, componentId, "content.json"]);

        const componentPlaceHolder = root.querySelectorAll(`div[${scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_ID}="${component.id}"]`)?.find((el) => {
          return el.getAttribute(scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_TYPE) === pageResourceTypes.COMPONENT;
        });

        if (componentPlaceHolder) {
          componentPlaceHolder.replaceWith(componentHtml);
        }

        if (component.scripts?.length) {
          component.scripts.forEach(async (script) => {
            if (script.content && !scriptIds.has(script.id)) {
              root.insertAdjacentHTML(
                "beforeend",
                `<script ${script.id ? `id="${script.id}"` : ""} ${script.dependWidgetId ? `depend-widget-id="${script.dependWidgetId}"` : ""}>${script.content}</script>`
              );
              scriptIds.add(script.id);
            }
          });
        }
      }
    });
  }

  if (widgetMetaData) {
    root
      .getElementById("core-script")
      ?.insertAdjacentHTML(
        "beforebegin",
        `<script type="text/json" id="${scriptSpecificVariables.WIDGET_META_DATA_ID}">${JSON.stringify(widgetMetaData)}</script>`
      );
    contentToSave[0] = {
      ...contentToSave[0],
      content: root.toString(),
    };
  }

  return root.toString();
};

export { validationConfiguration as validation, handler };
