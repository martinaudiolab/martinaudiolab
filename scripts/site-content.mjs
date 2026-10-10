// The editable site content (site-data/site-content.json): defaults and a
// normalizer that reduces untrusted input to known, size-limited fields.
// Pure code, shared by the admin API (publisher/worker.js) and the build scripts.

export const CONTENT_PATH = "site-data/site-content.json";
export const THEMES = ["auto", "dark", "light"];

const text = (v, max, fallback) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : fallback === undefined ? "" : fallback);
const str = (v, max, fallback) => {
  const out = typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "";
  return out || (fallback === undefined ? "" : fallback);
};

/** Site-relative paths ("shop/index.html", "about.html#top"), http(s) and mailto only. */
export function safeHref(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  if (/^(https?:\/\/|mailto:)[^\s"'<>]+$/i.test(v)) return true;
  return /^[a-zA-Z0-9][a-zA-Z0-9._\/-]*(#[a-zA-Z0-9_-]*)?$/.test(v) && !v.includes("..") && !v.includes("//");
}

/** Image paths inside the site's images/ folder, or an https URL. */
export function safeImage(value) {
  if (typeof value !== "string") return false;
  const v = value.trim();
  // External images: https only, a plain image file name, and no characters that could end a CSS url().
  if (/^https:\/\/[A-Za-z0-9._~%\/:@!$&*+,=-]+\.(jpe?g|png|webp)(\?[A-Za-z0-9._~%\/:@!$&*+,=-]*)?$/i.test(v)) return true;
  return /^images\/[a-zA-Z0-9][a-zA-Z0-9._\/-]*\.(jpe?g|png|webp)$/.test(v) && !v.includes("..") && !v.includes("//");
}

const httpsUrl = (v, fallback) => (typeof v === "string" && /^https:\/\/[^\s"'<>]+$/i.test(v.trim()) ? v.trim().slice(0, 300) : fallback);
const href = (v, fallback) => (safeHref(v) ? v.trim() : fallback);
const image = (v, fallback) => (safeImage(v) ? v.trim() : fallback);

export const DEFAULT_NAV = [
  { label: "Home", href: "index.html" },
  { label: "Shop", href: "shop/index.html" },
  { label: "Request a Restoration", href: "request.html" },
  {
    label: "Restoration Blog",
    children: [
      { label: "Stereo Repair", href: "stereo/index.html" },
      { label: "Radio Repair", href: "radio/index.html" },
      { label: "Test Equipment", href: "test-equipment/index.html" }
    ]
  },
  { label: "About Me", href: "about.html" }
];

const DEFAULT_CATEGORIES = [
  { label: "Stereo Repair", description: "", href: "stereo/index.html", image: "images/category-stereo.jpg" },
  { label: "Radio Repair", description: "", href: "radio/index.html", image: "images/category-radio.jpg" },
  { label: "Test Equipment", description: "", href: "test-equipment/index.html", image: "images/category-test-equipment.jpg" }
];

export const MAX = { nav: 8, navChildren: 8, categories: 6, sections: 12, heroSlides: 4 };

function normalizeNav(input) {
  const list = Array.isArray(input) ? input : null;
  if (!list) return DEFAULT_NAV.map((item) => JSON.parse(JSON.stringify(item)));
  const out = [];
  for (const raw of list.slice(0, MAX.nav)) {
    if (!raw || typeof raw !== "object") continue;
    const label = str(raw.label, 40);
    if (!label) continue;
    const children = Array.isArray(raw.children)
      ? raw.children.slice(0, MAX.navChildren).map((c) => (c && typeof c === "object" ? { label: str(c.label, 40), href: href(c.href, "") } : null)).filter((c) => c && c.label && c.href)
      : [];
    if (children.length) out.push({ label, children });
    else if (href(raw.href, "")) out.push({ label, href: raw.href.trim() });
  }
  return out.length ? out : DEFAULT_NAV.map((item) => JSON.parse(JSON.stringify(item)));
}

/** Up to four slideshow images; falls back to the legacy single image, then to the default photo. */
function heroSlides(hero) {
  const source = Array.isArray(hero.slides) ? hero.slides : hero.image ? [{ image: hero.image }] : [];
  const slides = source.slice(0, MAX.heroSlides)
    .map((slide) => {
      const o = slide && typeof slide === "object" ? slide : {};
      return { image: image(o.image, ""), alt: text(o.alt, 160, "") };
    })
    .filter((slide) => slide.image);
  return slides.length ? slides : [{ image: "images/banner.jpg", alt: "" }];
}

/**
 * Returns a complete, safe content object. Unknown keys are dropped; missing or
 * invalid values fall back to the defaults.
 */
export function normalizeContent(input) {
  const c = input && typeof input === "object" ? input : {};
  const h = c.homepage && typeof c.homepage === "object" ? c.homepage : {};
  const hero = h.hero && typeof h.hero === "object" ? h.hero : {};
  const intro = h.intro && typeof h.intro === "object" ? h.intro : {};
  const pc = h.product_carousel && typeof h.product_carousel === "object" ? h.product_carousel : {};
  const vl = pc.view_all_link && typeof pc.view_all_link === "object" ? pc.view_all_link : {};
  const r = c.request && typeof c.request === "object" ? c.request : {};
  const a = c.about && typeof c.about === "object" ? c.about : {};
  const ac = a.contact && typeof a.contact === "object" ? a.contact : {};

  const contactEmail = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(c.contact_email || "").trim()) ? c.contact_email.trim().slice(0, 120) : "thealexandersound@gmail.com";

  const categories = (Array.isArray(h.categories) ? h.categories : DEFAULT_CATEGORIES).slice(0, MAX.categories)
    .map((cat, i) => {
      const d = DEFAULT_CATEGORIES[i] || { label: "", description: "", href: "", image: "" };
      const o = cat && typeof cat === "object" ? cat : {};
      return {
        label: str(o.label, 60, d.label),
        description: text(o.description, 160, ""),
        href: href(o.href, d.href),
        image: image(o.image, d.image)
      };
    }).filter((cat) => cat.label && cat.href);

  return {
    site_name: str(c.site_name, 60, "Martin Audio Labs"),
    contact_email: contactEmail,
    nav_items: normalizeNav(c.nav_items),
    theme: THEMES.includes(c.theme) ? c.theme : "auto",
    homepage: {
      hero: {
        slides: heroSlides(hero),
        title: str(hero.title, 120, "High end audio and radio restorations."),
        subtitle: text(hero.subtitle, 200, "Stereo, radio and test equipment, restored with quality first")
      },
      intro: { text: str(intro.text, 1200, "I restore stereo, radio, and test equipment — one unit at a time, done right. Browse recent work or grab a part from the shop.") },
      categories: categories.length ? categories : JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
      product_carousel: {
        enabled: pc.enabled === undefined ? true : pc.enabled === true,
        heading: str(pc.heading, 60, "For Sale Now"),
        view_all_link: { label: str(vl.label, 40, "View All"), href: href(vl.href, "shop/index.html") }
      },
      trust_line: text(h.trust_line, 240, "")
    },
    request: {
      title: str(r.title, 80, "Request a Restoration"),
      intro: text(r.intro, 600, "Have a unit that needs attention? Send me the details and I will get back to you."),
      form_action: httpsUrl(r.form_action, "https://formspree.io/f/YOUR_FORM_ID"),
      subject: str(r.subject, 120, "New Restoration Request \u2014 Martin Audio Labs"),
      success_message: str(r.success_message, 240, "Thanks \u2014 I'll get back to you within 1-2 business days.")
    },
    about: {
      title: str(a.title, 80, "About Me"),
      bio: text(a.bio, 3000, ""),
      sections: (Array.isArray(a.sections) ? a.sections : []).slice(0, MAX.sections)
        .map((s) => (s && typeof s === "object" ? { heading: str(s.heading, 120), body: text(s.body, 12000, "") } : null))
        .filter((s) => s && (s.heading || s.body)),
      contact: {
        heading: text(ac.heading, 120, "Questions or comments?"),
        email: /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(String(ac.email || "").trim()) ? ac.email.trim().slice(0, 120) : ""
      },
      location: text(a.location, 160, ""),
      response_time: text(a.response_time, 160, "")
    }
  };
}

/** Image paths under images/site/ that this content refers to (for cleanup). */
export function contentImages(content) {
  const paths = content.homepage.hero.slides.map((s) => s.image).concat(content.homepage.categories.map((c) => c.image));
  return paths.filter((p) => typeof p === "string" && p.startsWith("images/"));
}
