import type { HandlerOptions, RenderConfig } from "@core/types";
import type { UserStreakConfigOut } from "./types";
import path from "path";
import fs from "fs";
import type { Plugin, Rule } from "postcss";
import cssnano from "cssnano";
import { parse, HTMLElement } from "node-html-parser";
import { pageResourceTypes, scriptSpecificVariables } from "@core/libs/constants";
import { buildCss } from "@core/libs/buildCss";

const validationConfiguration = {
  rootLayoutOut: (conf: RenderConfig) => (conf.rootLayout && typeof conf.rootLayout === "string" ? true : "rootLayout must be a non-empty string."),
};

const getExternalStyles = (options: HandlerOptions, root: HTMLElement) => {
  const cssContents: string[] = [];
  root.querySelectorAll("link[rel='stylesheet']").forEach((el) => {
    const href = el.getAttribute("href");

    if (href) {
      if (href.startsWith("http")) {
        throw new Error(`External CSS file detected: ${href}. This may not be processed correctly.`);
      }

      const htmlDir = href.startsWith("/") ? options.srcDir.publicDir : path.resolve(options.srcDir.layoutsDir, href);

      const cssPath = path.join(htmlDir, href);
      if (fs.existsSync(cssPath)) {
        const cssText = fs.readFileSync(cssPath, "utf8");
        cssContents.push(cssText);
      } else {
        console.warn(`CSS file not found: ${cssPath}`);
      }
    }
  });
  return cssContents;
};

const getStyleTagContents = (root: HTMLElement) => {
  const styleContents: string[] = [];
  root.querySelectorAll("style").forEach((el) => {
    const styleContent = el.innerHTML;
    if (styleContent) {
      styleContents.push(styleContent);
    }
  });
  return styleContents;
};

const removeAllExternalAndInternalStyles = (root: HTMLElement) => {
  root.querySelectorAll("link[rel='stylesheet']").forEach((el) => el.remove());
  root.querySelectorAll("style").forEach((el) => el.remove());
  return root;
};

const deduplicateCSS = (seenRules = new Set<string>()): Plugin => {
  return {
    postcssPlugin: "postcss-deduplicate",
    OnceExit(root) {
      root.walkRules((rule: Rule) => {
        const ruleStr = rule.toString();
        if (seenRules.has(ruleStr)) {
          rule.remove();
        } else {
          seenRules.add(ruleStr);
        }
      });
    },
  };
};

deduplicateCSS.postcss = true;

// Minifier plugin from cssnano
const minifyCSS = cssnano({
  preset: ["default", { discardComments: { removeAll: true } }],
});

const handler = (options: HandlerOptions) => async (previousConfig: UserStreakConfigOut) => {
  const rootLayoutOut = previousConfig.rootLayoutOut;
  const widgetOutMap = previousConfig.widgets;
  const dynamicComponents = previousConfig.dynamicComponents || {};

  console.log("Applying styles to the page and widgets...");

  let root = parse(rootLayoutOut);

  const allStyleContents = getExternalStyles(options, root).concat(getStyleTagContents(root));

  root = removeAllExternalAndInternalStyles(root);
  const secondaryRoot = parse(root.toString());

  widgetOutMap?.forEach((widget, index) => {
    if (widget.out) {
      const outRoot = parse(widget.out);

      const widgetPlaceHolder = secondaryRoot.querySelectorAll(`div[${scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_ID}="${widget.id}"]`)?.find((el) => {
        return el.getAttribute(scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_TYPE) === pageResourceTypes.WIDGET;
      });

      if (widgetPlaceHolder) {
        widgetPlaceHolder.replaceWith(outRoot);
      } else {
        try {
          const dynamicPlaceholder = secondaryRoot.querySelector(`div[${scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_TYPE}="${pageResourceTypes.DYNAMIC}"]`);
          if (dynamicPlaceholder) {
            dynamicPlaceholder.insertAdjacentHTML("beforebegin", outRoot.toString());
          }
        } catch (error) {
          console.error(error);
        }
      }

      const style = getStyleTagContents(outRoot);
      if (style.length > 0) {
        allStyleContents.push(...style);
      }
    }
  });

  dynamicComponents?.forEach((component) => {
    if (component.html) {
      const outRoot = parse(component.html);
      if (outRoot) {
        const style = getStyleTagContents(outRoot);
        if (style.length > 0) {
          allStyleContents.push(...style);
        }
        component.html = outRoot.toString();

        const componentPlaceHolder = secondaryRoot
          .querySelectorAll(`div[${scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_ID}="${component.id}"]`)
          ?.find((el) => {
            return el.getAttribute(scriptSpecificVariables.DYNAMIC_COMPONENT_KEY_TYPE) === pageResourceTypes.COMPONENT;
          });

        if (componentPlaceHolder) {
          componentPlaceHolder.replaceWith(outRoot);
        }
      }
    }
  });

  const completePageStyles = allStyleContents.join("\n");

  const seenRules = new Set<string>();

  const widgetCss = await buildCss(secondaryRoot.toString(), completePageStyles, deduplicateCSS(seenRules));

  return { ...previousConfig, rootLayoutOut: root.toString(), css: widgetCss } as UserStreakConfigOut;
};

export { validationConfiguration as validation, handler };
