// Cleans post HTML on the Worker side. The browser sanitises too; this is the authority.

const DROP_TAGS = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "SVG", "MATH", "FORM", "VIDEO", "AUDIO"]);
const ALLOWED_TAGS = new Set(["A", "BLOCKQUOTE", "BR", "CODE", "EM", "FIGURE", "H2", "H3", "H4", "HR", "IMG", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "U", "UL"]);

function safeSpanStyle(value) {
  const styles = [];
  const size = value.match(/(?:^|;)\s*font-size\s*:\s*(\d{1,2})px\s*(?=;|$)/i);
  if (size && Number(size[1]) >= 10 && Number(size[1]) <= 72) styles.push("font-size: " + Number(size[1]) + "px");
  const color = value.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-f]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))\s*(?=;|$)/i);
  if (color) {
    if (color[1].charAt(0) === "#") styles.push("color: " + color[1]);
    else {
      const values = color[1].match(/\d+/g).map(Number);
      if (values.every(function (component) { return component <= 255; })) styles.push("color: rgb(" + values.join(", ") + ")");
    }
  }
  return styles.join("; ");
}

export async function sanitizeContent(html, siteOrigin) {
  const input = new Response("<div>" + html + "</div>", { headers: { "Content-Type": "text/html; charset=utf-8" } });
  return new HTMLRewriter().on("*", {
    element: function (element) {
      const tagName = element.tagName.toUpperCase();
      if (DROP_TAGS.has(tagName)) {
        element.remove();
        return;
      }
      if (!ALLOWED_TAGS.has(tagName)) {
        element.removeAndKeepContent();
        return;
      }
      Array.from(element.attributes).forEach(function (attribute) {
        const name = attribute[0];
        const value = attribute[1] || "";
        if (tagName === "A" && name === "href") {
          try {
            const protocol = new URL(value, siteOrigin).protocol;
            if (["http:", "https:", "mailto:"].includes(protocol) || value.charAt(0) === "#") return;
          } catch (error) { }
        } else if (tagName === "IMG" && name === "src" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) {
          return;
        } else if (tagName === "IMG" && name === "alt") {
          return;
        } else if (tagName === "IMG" && name === "data-w" && ["25", "50", "75", "100"].includes(value)) {
          return;
        } else if (tagName === "IMG" && name === "data-a" && ["c", "l", "r"].includes(value)) {
          return;
        } else if (tagName === "FIGURE" && name === "data-gallery" && ["2", "4"].includes(value)) {
          return;
        } else if (tagName === "FIGURE" && name === "data-w" && ["25", "50", "75", "100"].includes(value)) {
          return;
        } else if (tagName === "FIGURE" && name === "data-a" && ["c", "l", "r"].includes(value)) {
          return;
        } else if (tagName === "SPAN" && name === "style") {
          const style = safeSpanStyle(value);
          if (style) {
            element.setAttribute("style", style);
            return;
          }
        }
        element.removeAttribute(name);
      });
      if (tagName === "IMG" && !element.hasAttribute("src")) element.remove();
    }
  }).transform(input).text();
}
