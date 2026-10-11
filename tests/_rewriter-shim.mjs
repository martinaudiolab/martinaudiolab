// A small jsdom-backed stand-in for Cloudflare's HTMLRewriter, enough for the publisher Worker's usage.
import { JSDOM } from "jsdom";

class Rewriter {
  constructor() { this.rules = []; }
  on(selector, handlers) { this.rules.push({ selector, handlers }); return this; }
  transform(response) {
    const rules = this.rules;
    return {
      async text() {
        const input = await response.text();
        const full = /^\s*<(!doctype|html)/i.test(input);
        const dom = new JSDOM(full ? input : "<body>" + input + "</body>");
        const doc = dom.window.document;
        for (const { selector, handlers } of rules) {
          for (const node of Array.from((full ? doc : doc.body).querySelectorAll(selector))) {
            if (handlers.element) {
              const wrap = {
                tagName: node.tagName.toLowerCase(),
                get attributes() { return Array.from(node.attributes).map((a) => [a.name, a.value]); },
                removeAttribute: (n) => node.removeAttribute(n),
                setAttribute: (n, v) => node.setAttribute(n, v),
                getAttribute: (n) => node.getAttribute(n),
                hasAttribute: (n) => node.hasAttribute(n),
                remove: () => node.remove(),
                removeAndKeepContent: () => { while (node.firstChild) node.parentNode.insertBefore(node.firstChild, node); node.remove(); },
                after: (html) => node.insertAdjacentHTML("afterend", html),
                prepend: (html) => node.insertAdjacentHTML("afterbegin", html),
                before: (html) => node.insertAdjacentHTML("beforebegin", html)
              };
              handlers.element(wrap);
            }
            if (handlers.text) handlers.text({ text: node.textContent, lastInTextNode: true });
          }
        }
        return full ? dom.serialize() : doc.body.innerHTML;
      }
    };
  }
}
globalThis.HTMLRewriter = Rewriter;
