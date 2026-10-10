// Post Builder: the "Post Builder" tab of the admin panel.
// Sign-in and API access come from window.AdminShell (see admin.js); this file
// owns the rich-text editor, drafts, publishing and published-post management.
(function () {
  "use strict";

  var shell = window.AdminShell;
  if (!shell) return;

  var DRAFT_KEY = "martin-audio-labs-post-draft";
  var ALLOWED_TAGS = new Set(["A", "BLOCKQUOTE", "BR", "CODE", "EM", "FIGURE", "H2", "H3", "H4", "HR", "IMG", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "U", "UL"]);
  var DROPPED_TAGS = "script,style,iframe,object,embed,svg,math,form,video,audio";
  // execCommand("bold" / "italic") produces <b> and <i>; the site uses <strong> and <em>.
  var RENAMED_TAGS = { B: "strong", I: "em" };
  var IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,/i;
  var IMAGE_FILE_TYPE = /^image\/(png|jpeg|gif|webp)$/;
  var IMAGE_WIDTHS = ["25", "50", "75", "100"];
  var IMAGE_ALIGNMENTS = ["c", "l", "r"];

  var connected = false;
  var savedRange = null;        // last selection inside the editor, restored before toolbar commands
  var selectedImage = null;
  var managedSnapshot = null;   // { category, indexSha, indexHtml } for the post list on screen

  function $(id) { return document.getElementById(id); }
  function say(message) { $("pb-status").textContent = message; }

  // ---- Browser storage (may be unavailable or blocked) -----------------------

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (error) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch (error) { return false; }
  }

  function storageRemove(key) {
    try { localStorage.removeItem(key); } catch (error) { }
  }

  // ---- HTML sanitising --------------------------------------------------------
  // The publisher Worker sanitises again on its side; this keeps previews and
  // restored drafts to the same allow-list.

  function isSafeLink(value) {
    try {
      var url = new URL(value, window.location.href);
      return ["http:", "https:", "mailto:"].includes(url.protocol) || value.charAt(0) === "#";
    } catch (error) {
      return false;
    }
  }

  /** font-size (10-72px) and color (#hex or rgb()) are the only styles allowed on spans. */
  function safeSpanStyle(element) {
    var styles = [];
    var size = parseInt(element.style.fontSize, 10);
    if (size >= 10 && size <= 72) styles.push("font-size: " + size + "px");
    var color = element.style.color;
    if (/^#[0-9a-f]{3,8}$/i.test(color)) {
      styles.push("color: " + color);
    } else {
      var rgb = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
      if (rgb && rgb.slice(1).every(function (component) { return Number(component) <= 255; })) {
        styles.push("color: rgb(" + rgb.slice(1).join(", ") + ")");
      }
    }
    return styles.join("; ");
  }

  /** Returns the value an attribute may keep, or null when it must be removed. */
  function allowedAttribute(element, name, value) {
    var tag = element.tagName;
    if (tag === "A" && name === "href") return isSafeLink(value) ? value : null;
    if (tag === "SPAN" && name === "style") return safeSpanStyle(element) || null;
    if (tag === "IMG") {
      if (name === "src") return IMAGE_DATA_URL.test(value) ? value : null;
      if (name === "alt") return value;
      if (name === "data-w") return IMAGE_WIDTHS.includes(value) ? value : null;
      if (name === "data-a") return IMAGE_ALIGNMENTS.includes(value) ? value : null;
    }
    return null;
  }

  function renameElement(element, tagName) {
    var replacement = document.createElement(tagName);
    replacement.append.apply(replacement, Array.from(element.childNodes));
    element.replaceWith(replacement);
    return replacement;
  }

  function sanitizeChildren(parent) {
    Array.from(parent.children).forEach(function (element) {
      sanitizeChildren(element);
      if (RENAMED_TAGS[element.tagName]) element = renameElement(element, RENAMED_TAGS[element.tagName]);
      if (!ALLOWED_TAGS.has(element.tagName)) {
        element.replaceWith.apply(element, Array.from(element.childNodes));
        return;
      }
      Array.from(element.attributes).forEach(function (attribute) {
        var name = attribute.name.toLowerCase();
        var kept = allowedAttribute(element, name, attribute.value);
        if (kept === null) element.removeAttribute(attribute.name);
        else if (kept !== attribute.value) element.setAttribute(attribute.name, kept);
      });
      if (element.tagName === "IMG" && !element.hasAttribute("src")) element.remove();
    });
  }

  function cleanHtml(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll(DROPPED_TAGS).forEach(function (element) { element.remove(); });
    sanitizeChildren(template.content);
    return template.innerHTML;
  }

  // ---- Post data ----------------------------------------------------------------

  function slugify(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  }

  function dateLabel(value) {
    var date = new Date(value + "T00:00:00Z");
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  }

  /** Today's date in the author's time zone, as YYYY-MM-DD. */
  function todayLocal() {
    var now = new Date();
    return now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  }

  function postData() {
    var select = $("category");
    var title = $("post-title").value.trim();
    return {
      categoryKey: select.value,
      categoryName: select.selectedOptions[0].textContent,
      title: title,
      slug: slugify(title),
      summary: $("post-summary").value.trim(),
      date: $("post-date").value,
      content: cleanHtml($("post-content").innerHTML)
    };
  }

  // ---- Drafts ---------------------------------------------------------------------

  function saveDraft() {
    var draft = {
      category: $("category").value,
      title: $("post-title").value,
      summary: $("post-summary").value,
      date: $("post-date").value,
      content: $("post-content").innerHTML
    };
    say(storageSet(DRAFT_KEY, JSON.stringify(draft)) ? "Draft saved in this browser." : "Draft could not be saved in this browser.");
  }

  function loadDraft() {
    var stored = storageGet(DRAFT_KEY);
    if (!stored) return;
    try {
      var draft = JSON.parse(stored);
      if (!draft || typeof draft !== "object") return;
      var category = $("category");
      if (Array.from(category.options).some(function (option) { return option.value === draft.category; })) category.value = draft.category;
      $("post-title").value = draft.title || "";
      $("post-summary").value = draft.summary || "";
      if (draft.date) $("post-date").value = draft.date;
      $("post-content").innerHTML = cleanHtml(draft.content || "");
      say("Restored the saved draft from this browser.");
    } catch (error) {
      storageRemove(DRAFT_KEY);
    }
  }

  function clearDraft() {
    storageRemove(DRAFT_KEY);
    $("post-form").reset();
    $("post-date").value = todayLocal();
    $("post-content").innerHTML = "<p></p>";
    deselectImage();
    hidePreview();
    say("Draft cleared.");
  }

  // ---- Session ---------------------------------------------------------------------

  function applySession(session) {
    connected = Boolean(session);
    $("pb-publish").disabled = !connected;
    if (!connected) {
      managedSnapshot = null;
      $("managed-posts").textContent = "";
      $("manage-status").textContent = "";
    } else if (managePanelVisible()) {
      loadManagedPosts();
    }
  }

  function managePanelVisible() {
    return !document.querySelector('[data-panel="manage-posts"]').hidden;
  }

  function isAuthError(error) {
    return error.status === 401 || error.status === 403;
  }

  // ---- Publishing --------------------------------------------------------------------

  /** A small JPEG (base64) for the section page: the chosen file, else the first photo in the post. */
  function thumbnailBase64() {
    var chosen = $("post-thumb").files && $("post-thumb").files[0];
    var firstPhoto = $("post-content").querySelector('img[src^="data:image"]');
    var source = chosen ? URL.createObjectURL(chosen) : firstPhoto ? firstPhoto.getAttribute("src") : "";
    if (!source) return Promise.resolve("");
    return new Promise(function (resolve) {
      var timer = window.setTimeout(function () { resolve(""); }, 6000);
      var image = new Image();
      image.onload = function () {
        window.clearTimeout(timer);
        if (chosen) URL.revokeObjectURL(source);
        var scale = Math.min(1, 720 / Math.max(image.naturalWidth, image.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        var context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var url = canvas.toDataURL("image/jpeg", 0.82);
        resolve(url.slice(url.indexOf(",") + 1));
      };
      image.onerror = function () { window.clearTimeout(timer); if (chosen) URL.revokeObjectURL(source); resolve(""); };
      image.src = source;
    });
  }

  async function publish() {
    if (!$("post-form").reportValidity()) return;
    if (!connected) {
      say("Connect an administrator GitHub account before publishing.");
      return;
    }
    var data = postData();
    if (!data.slug) { say("Add a title with at least one letter or number."); return; }
    if (!data.content.trim()) { say("Add some post content before publishing."); return; }

    var button = $("pb-publish");
    button.disabled = true;
    try {
      say("Publishing to GitHub...");
      var thumbnail = await thumbnailBase64();
      var result = await shell.api("/api/publish", {
        method: "POST",
        body: { category: data.categoryKey, title: data.title, summary: data.summary, date: data.date, content: data.content, thumbnail: thumbnail }
      });
      $("post-thumb").value = "";
      say("Published " + result.filename + " to " + result.section + ". The website will update after deployment.");
      storageRemove(DRAFT_KEY);
    } catch (error) {
      if (isAuthError(error)) shell.expired(error.message);
      say(error.message || "Could not publish to GitHub.");
    } finally {
      button.disabled = !connected;
    }
  }

  // ---- Managing published posts ---------------------------------------------------

  /** The <article class="post"> entries of a section index that link to a post page. */
  function indexPosts(doc) {
    return Array.from(doc.querySelectorAll("main article.post")).map(function (article) {
      var link = article.querySelector("h2 a[href]");
      var match = link && link.getAttribute("href").match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/);
      return match ? { slug: match[1], title: link.textContent.trim(), article: article } : null;
    }).filter(Boolean);
  }

  function postsFromIndex(indexHtml) {
    return indexPosts(new DOMParser().parseFromString(indexHtml, "text/html"))
      .map(function (post) { return { slug: post.slug, title: post.title }; });
  }

  function indexWithoutPost(indexHtml, slug) {
    var parsed = new DOMParser().parseFromString(indexHtml, "text/html");
    var matches = indexPosts(parsed).filter(function (post) { return post.slug === slug; });
    if (matches.length !== 1) throw new Error("Could not find exactly one matching post in this section. Refresh the list and try again.");
    matches[0].article.remove();
    return "<!DOCTYPE html>\n" + parsed.documentElement.outerHTML;
  }

  function renderManagedPosts(indexHtml) {
    var list = $("managed-posts");
    var posts = postsFromIndex(indexHtml);
    list.replaceChildren();
    if (!posts.length) {
      list.textContent = "No posts found in this section.";
      return 0;
    }
    posts.forEach(function (post) {
      var title = document.createElement("span");
      title.textContent = post.title;
      var button = document.createElement("button");
      button.className = "btn alt";
      button.type = "button";
      button.textContent = "Delete";
      button.setAttribute("aria-label", "Delete " + post.title);
      button.addEventListener("click", function () { deleteManagedPost(post); });
      var row = document.createElement("div");
      row.className = "managed-post";
      row.append(title, button);
      list.appendChild(row);
    });
    return posts.length;
  }

  async function loadManagedPosts() {
    var manageStatus = $("manage-status");
    manageStatus.textContent = "Loading posts...";
    $("managed-posts").textContent = "";
    try {
      managedSnapshot = await shell.api("/api/posts?category=" + encodeURIComponent($("manage-category").value));
      var count = renderManagedPosts(managedSnapshot.indexHtml);
      manageStatus.textContent = count ? count + " post" + (count === 1 ? "" : "s") + " loaded." : "";
    } catch (error) {
      managedSnapshot = null;
      manageStatus.textContent = error.message || "Could not load posts.";
    }
  }

  async function deleteManagedPost(post) {
    if (!connected || !managedSnapshot) return;
    if (!window.confirm("Permanently delete \"" + post.title + "\" and remove it from this section?")) return;
    var manageStatus = $("manage-status");
    manageStatus.textContent = "Deleting " + post.title + "...";
    try {
      var result = await shell.api("/api/delete", {
        method: "POST",
        body: {
          // The section the list was loaded for, even if the dropdown has moved since.
          category: managedSnapshot.category,
          slug: post.slug,
          indexSha: managedSnapshot.indexSha,
          indexHtml: indexWithoutPost(managedSnapshot.indexHtml, post.slug)
        }
      });
      await loadManagedPosts();
      manageStatus.textContent = "Deleted " + result.filename + " from " + result.section + ". The website will update after deployment.";
    } catch (error) {
      if (isAuthError(error)) shell.expired(error.message);
      manageStatus.textContent = error.message || "Could not delete that post.";
    }
  }

  // ---- Editor commands ---------------------------------------------------------------

  function restoreSelection() {
    var editor = $("post-content");
    editor.focus();
    if (!savedRange) return;
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }

  function runCommand(command, value) {
    restoreSelection();
    document.execCommand(command, false, value === undefined ? null : value);
  }

  /** execCommand wraps styled text in <font>; swap those for the <span style> the site allows. */
  function replaceFontElements(selector, applyStyle) {
    $("post-content").querySelectorAll(selector).forEach(function (font) {
      var span = document.createElement("span");
      if (applyStyle(span, font) === false) return;
      span.append.apply(span, Array.from(font.childNodes));
      font.replaceWith(span);
    });
  }

  function applyFontSize() {
    var input = $("font-size");
    var size = Math.max(10, Math.min(72, parseInt(input.value, 10) || 18));
    input.value = size;
    runCommand("fontSize", "7");
    replaceFontElements('font[size="7"]', function (span) { span.style.fontSize = size + "px"; });
  }

  function applyTextColor(event) {
    runCommand("foreColor", event.target.value);
    replaceFontElements("font[color]", function (span, font) {
      var color = font.getAttribute("color");
      if (!/^#[0-9a-f]{3,8}$/i.test(color)) return false;
      span.style.color = color;
    });
  }

  function addLink() {
    var url = window.prompt("Enter a web or email link:");
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = "https://" + url;
    runCommand("createLink", url);
  }

  // ---- Images -------------------------------------------------------------------------

  function insertImage(file) {
    if (!IMAGE_FILE_TYPE.test(file.type)) {
      say("Choose a PNG, JPEG, GIF or WebP image.");
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      runCommand("insertHTML", '<img src="' + reader.result + '" alt="" data-w="100" data-a="c">');
    };
    reader.onerror = function () { say("That image could not be read."); };
    reader.readAsDataURL(file);
  }

  function deselectImage() {
    if (selectedImage) selectedImage.classList.remove("sel");
    selectedImage = null;
    $("image-tools").hidden = true;
  }

  function selectImage(image) {
    deselectImage();
    selectedImage = image;
    image.classList.add("sel");
    $("image-width").value = image.dataset.w || "100";
    $("image-align").value = image.dataset.a || "c";
    $("image-alt").value = image.alt || "";
    $("image-tools").hidden = false;
  }

  // ---- Preview ----------------------------------------------------------------------

  function hidePreview() {
    $("preview").hidden = true;
    $("preview-toggle").textContent = "Preview";
  }

  function togglePreview() {
    var preview = $("preview");
    if (!preview.hidden) { hidePreview(); return; }
    var data = postData();
    var title = document.createElement("h2");
    title.textContent = data.title || "Post preview";
    var meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = (data.date ? dateLabel(data.date) : "") + "  |  " + data.categoryName;
    var body = document.createElement("div");
    body.className = "body";
    body.innerHTML = data.content;   // already sanitised by postData()
    preview.replaceChildren(title, meta, body);
    preview.hidden = false;
    $("preview-toggle").textContent = "Hide preview";
  }

  // ---- Wiring --------------------------------------------------------------------------

  function wireToolbar() {
    // Keep the editor's selection while a toolbar button is pressed.
    document.querySelectorAll("#post-form .tb button").forEach(function (button) {
      button.addEventListener("mousedown", function (event) { event.preventDefault(); });
    });
    document.querySelectorAll("#post-form [data-command]").forEach(function (button) {
      button.addEventListener("click", function () { runCommand(button.dataset.command); });
    });
    $("apply-block").addEventListener("click", function () {
      runCommand("formatBlock", "<" + $("block-style").value + ">");
    });
    $("apply-size").addEventListener("click", applyFontSize);
    $("text-color").addEventListener("input", applyTextColor);
    $("add-link").addEventListener("click", addLink);
  }

  function wireImages() {
    var editor = $("post-content");
    $("add-image").addEventListener("click", function () { $("image-file").click(); });
    $("image-file").addEventListener("change", function (event) {
      var file = event.target.files[0];
      event.target.value = "";
      if (file) insertImage(file);
    });
    editor.addEventListener("click", function (event) {
      var image = event.target.closest("img");
      if (image) selectImage(image);
      else deselectImage();
    });
    $("image-width").addEventListener("change", function (event) {
      if (selectedImage) selectedImage.dataset.w = event.target.value;
    });
    $("image-align").addEventListener("change", function (event) {
      if (selectedImage) selectedImage.dataset.a = event.target.value;
    });
    $("image-alt").addEventListener("input", function (event) {
      if (selectedImage) selectedImage.alt = event.target.value;
    });
    $("remove-image").addEventListener("click", function () {
      if (selectedImage) selectedImage.remove();
      deselectImage();
    });
  }

  function wireManager() {
    // The list is fetched fresh each time the Manage Blog Posts tab opens.
    document.addEventListener("admin:tab", function (event) {
      if (event.detail === "manage-posts" && connected) loadManagedPosts();
    });
    $("manage-category").addEventListener("change", loadManagedPosts);
    $("refresh-posts").addEventListener("click", loadManagedPosts);
  }

  function init() {
    $("post-date").value = todayLocal();
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch (error) { }
    loadDraft();

    document.addEventListener("selectionchange", function () {
      var editor = $("post-content");
      var selection = window.getSelection();
      if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
        savedRange = selection.getRangeAt(0).cloneRange();
      }
    });

    wireToolbar();
    wireImages();
    wireManager();
    $("preview-toggle").addEventListener("click", togglePreview);
    $("save-draft").addEventListener("click", saveDraft);
    $("clear-draft").addEventListener("click", clearDraft);
    $("pb-publish").addEventListener("click", publish);
    shell.onSession(applySession);
  }

  init();
})();
