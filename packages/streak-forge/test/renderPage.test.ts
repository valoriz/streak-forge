/**
 * Tests for the page-assembly path (assemblePage): widget fragments -> the
 * <script>s inside them get extracted and re-emitted into the document.
 *
 * The hazard: injected script text legitimately contains "$&" / "$`" / "$'"
 * / "$$" - a minifier's `x&&y` short-circuit where the variable is named `$`,
 * a price string like "$5", and so on. Every injection point must therefore
 * use a replacer *function*, never a string, or JS's replacement-pattern
 * substitution rewrites those sequences (turning "$&" into the matched text).
 */

import { describe, test, expect } from "bun:test";
import { assemblePage } from "../src/render/postProcess";
import { SCRIPT_OPTS_ATTR, OPTS_PLACEHOLDER } from "../src/constants";

describe("assemblePage keeps injected script content verbatim", () => {
  test('"$&&(" in a widget script is not substituted with the match', () => {
    const scriptBody = `var $=document.body;$&&($.innerHTML="<svg><rect/></svg>"),done()`;
    const widgetHtml = `<div>hi<script id="w">${scriptBody}</script></div>`;

    const page = assemblePage(
      `<html><body><widget id="W" type="W"></widget><footer>page footer</footer></body></html>`,
      [{ id: "W", type: "W", html: widgetHtml }],
      "/",
    );

    const s = page.trailingScripts.find((x) => x.id === "w");
    expect(s?.content).toBe(scriptBody); // byte-for-byte
    expect(s?.content).not.toContain("</body>");
    expect(s?.content).not.toContain("page footer");
  });

  test('"$$" / "$1" inside spliced options data round-trips (no $-pattern substitution)', () => {
    // data-sf-opts carries the JSON; renderToString escapes " -> &quot; in it,
    // which node-html-parser decodes back on getAttribute.
    const optsJson = JSON.stringify({ price: "$$ save $1 & $&" }).replace(
      /"/g,
      "&quot;",
    );
    const widgetHtml =
      `<div><script id="w" ${SCRIPT_OPTS_ATTR}="${optsJson}">` +
      `((o)=>{console.log(o)})(${OPTS_PLACEHOLDER});</script></div>`;

    const page = assemblePage(
      `<html><body><widget id="W" type="W"></widget></body></html>`,
      [{ id: "W", type: "W", html: widgetHtml }],
      "/",
    );

    const s = page.trailingScripts.find((x) => x.id === "w");
    expect(s?.content).toContain("$$ save $1 & $&");
    expect(s?.content).not.toContain(OPTS_PLACEHOLDER);
  });
});
