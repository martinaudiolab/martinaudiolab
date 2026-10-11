// The blog sections of the site: the one place that says which sections exist.
// Everything else (navigation, homepage rows, the publisher Worker, the build, the
// admin dropdowns, the sitemap) reads this list. To add a section, add it here, create
// site/<folder>/index.html (copy an existing section page), and rebuild.
//
// Pure data: shared by publisher/worker.js and the build scripts.

export const SECTIONS = [
  {
    key: "stereo",
    folder: "stereo",
    name: "Stereo Repair",
    tag: "Stereo",
    description: "Receivers, amplifiers and turntables brought back to specification, with every step documented.",
    image: "images/category-stereo.jpg"
  },
  {
    key: "radio",
    folder: "radio",
    name: "Radio Repair",
    tag: "Radio",
    description: "Vintage tube and solid-state radios restored for safe, reliable listening, from chassis to cabinet.",
    image: "images/category-radio.jpg"
  },
  {
    key: "test-equipment",
    folder: "test-equipment",
    name: "Test Equipment",
    tag: "Test Equipment",
    description: "Bench instruments serviced and recalibrated so your measurements can be trusted.",
    image: "images/category-test-equipment.jpg"
  }
];

/** The page that lists posts from every section. */
export const BLOG_HUB = {
  folder: "blog",
  name: "Restoration Blog",
  href: "blog/index.html",
  intro: "Write-ups from the bench: stereo, radio and test equipment, restored one unit at a time."
};

export const sectionByKey = (key) => SECTIONS.find((s) => s.key === key) || null;
export const sectionByFolder = (folder) => SECTIONS.find((s) => s.folder === folder) || null;
