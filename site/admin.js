(function () {
  "use strict";

  var statusLine = document.getElementById("status");
  var apiUrl = document.querySelector('meta[name="publisher-api-url"]').content.trim().replace(/\/+$/, "");
  var session = null;
  var content = null;           // the site content being edited
  var shop = { title: "" };
  var contentSha = "";
  var shopSha = "";
  var pending = {};             // new image path -> { base64, dataUrl, uploaded }
  var dirty = false;
  var sessionListeners = [];
  // The Shop Builder and Post Builder tabs share this sign-in instead of having their own.
  window.AdminShell = {
    api: api,
    onSession: function (listener) {
      sessionListeners.push(listener);
      if (session) listener(session);
    },
    expired: function (message) { signedOut(message); }
  };
  var CONTENT_TABS = ["global", "homepage", "request", "about", "shop"];

  function notifySession() {
    sessionListeners.forEach(function (listener) { listener(session); });
  }

  function $(id) { return document.getElementById(id); }
  function say(message) { statusLine.textContent = message || ""; }

  function el(tag, props, children) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (key) {
      if (key === "text") node.textContent = props[key];
      else if (key === "class") node.className = props[key];
      else node.setAttribute(key, props[key]);
    });
    (children || []).forEach(function (child) { if (child) node.appendChild(child); });
    return node;
  }

  // ---- API ----------------------------------------------------------------

  async function api(path, options) {
    var request = Object.assign({}, options || {});
    request.headers = Object.assign({ Accept: "application/json" }, request.headers || {});
    if (session) request.headers.Authorization = "Bearer " + session;
    if (request.body && typeof request.body !== "string") {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(request.body);
    }
    var response = await fetch(apiUrl + path, request);
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(result.error || "The publisher returned HTTP " + response.status + ".");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  function setConnected(connected, message) {
    $("github-status").textContent = message;
    $("github-connect").hidden = connected;
    $("github-disconnect").hidden = !connected;
    $("admin-app").hidden = !connected;
  }

  function signedOut(message) {
    session = null;
    content = null;
    setConnected(false, "GitHub sign-in required");
    notifySession();
    if (message) say(message);
  }

  function showTab(name) {
    var found = false;
    document.querySelectorAll(".tab").forEach(function (tab) {
      var on = tab.dataset.tab === name;
      found = found || on;
      tab.classList.toggle("on", on);
      tab.setAttribute("aria-selected", String(on));
    });
    if (!found) return;
    document.querySelectorAll(".admin-panel").forEach(function (panel) {
      panel.hidden = panel.dataset.panel !== name;
    });
    document.querySelector(".admin-save").hidden = CONTENT_TABS.indexOf(name) === -1;
    try { sessionStorage.setItem("admin-tab", name); } catch (error) { }
    document.dispatchEvent(new CustomEvent("admin:tab", { detail: name }));
  }

  // ---- Data paths ---------------------------------------------------------

  function getPath(object, path) {
    return path.split(".").reduce(function (value, key) { return value == null ? undefined : value[key]; }, object);
  }

  function setPath(object, path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    var target = keys.reduce(function (node, key) {
      if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
      return node[key];
    }, object);
    target[last] = value;
  }

  function markDirty() {
    dirty = true;
    $("save").disabled = false;
    $("dirty-note").textContent = "You have unsaved changes.";
  }

  function markClean() {
    dirty = false;
    $("save").disabled = true;
    $("dirty-note").textContent = "Everything shown here is live.";
  }

  // ---- Simple bound fields ------------------------------------------------

  function fillFields() {
    document.querySelectorAll("[data-path]").forEach(function (input) {
      var value = getPath(content, input.dataset.path);
      if (input.type === "checkbox") input.checked = value === true;
      else if (input.dataset.list === "lines") input.value = Array.isArray(value) ? value.join("\n") : "";
      else input.value = value == null ? "" : String(value);
    });
    $("s-title").value = shop.title || "";
  }

  function bindFields() {
    document.querySelectorAll("[data-path]").forEach(function (input) {
      var handler = function () {
        var value;
        if (input.type === "checkbox") value = input.checked;
        else if (input.dataset.list === "lines") value = input.value.split("\n").map(function (line) { return line.trim(); }).filter(Boolean);
        else value = input.value;
        setPath(content, input.dataset.path, value);
        markDirty();
      };
      input.addEventListener(input.type === "checkbox" || input.tagName === "SELECT" ? "change" : "input", handler);
    });
    document.querySelectorAll("[data-shop]").forEach(function (input) {
      input.addEventListener("input", function () {
        shop[input.dataset.shop] = input.value;
        markDirty();
      });
    });
  }

  // ---- Images -------------------------------------------------------------

  function imageSrc(path) { return pending[path] ? pending[path].dataUrl : path; }

  function resizeImage(file, maxSide) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        var canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        var context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        var dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl: dataUrl, base64: dataUrl.slice(dataUrl.indexOf(",") + 1) });
      };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error(file.name + " could not be read as an image.")); };
      image.src = url;
    });
  }

  async function pickImage(file, kind, maxSide) {
    var photo = await resizeImage(file, maxSide);
    if (photo.base64.length * 0.75 > 3000000) throw new Error("That image is too large even after resizing. Try a smaller one.");
    var path = "images/site/" + kind + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6) + ".jpg";
    pending[path] = photo;
    return path;
  }

  var HERO_SLOTS = 4;

  function renderHeroSlots() {
    var holder = $("hero-slots");
    holder.replaceChildren();
    var slides = content.homepage.hero.slides;
    for (var index = 0; index < HERO_SLOTS; index++) {
      holder.appendChild(heroSlot(slides, index));
    }
  }

  function heroSlot(slides, index) {
    var slide = slides[index] || null;
    var number = index + 1;
    var row = el("div", { class: "ae-row ae-cat" });
    var thumb = slide
      ? el("img", { class: "ae-thumb", alt: "", src: imageSrc(slide.image) })
      : el("div", { class: "ae-thumb ae-empty", text: "Empty" });

    var file = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: "" });
    var pick = smallButton(slide ? "Replace image" : "Choose image", "Choose image for slideshow slot " + number, function () { file.click(); });
    file.addEventListener("change", async function () {
      var chosen = file.files[0];
      file.value = "";
      if (!chosen) return;
      try {
        var path = await pickImage(chosen, "hero", 2000);
        if (slide) slide.image = path;
        else slides.push({ image: path, alt: "" });
        markDirty();
        renderHeroSlots();
      } catch (error) { say(error.message); }
    });

    var alt = textInput(slide ? slide.alt : "", "Alt text (optional)", "Alt text for slideshow slot " + number, function (value) {
      if (slide) slide.alt = value;
    });
    alt.disabled = !slide;

    var remove = smallButton("Remove image", "Remove slideshow image " + number, function () {
      slides.splice(index, 1);
      markDirty();
      renderHeroSlots();
    }, !slide || slides.length < 2);
    if (slide && slides.length < 2) remove.title = "The slideshow needs at least one image.";

    row.append(thumb, el("div", { class: "ae-fields" }, [el("strong", { text: "Slot " + number }), alt]), el("div", { class: "sb-actions" }, [pick, file, remove]));
    return row;
  }

  // ---- Navigation editor --------------------------------------------------

  function textInput(value, placeholder, label, onInput, list) {
    var input = el("input", { type: "text", placeholder: placeholder, "aria-label": label, maxlength: "200" });
    if (list) input.setAttribute("list", list);
    input.value = value || "";
    input.addEventListener("input", function () { onInput(input.value); markDirty(); });
    return input;
  }

  function smallButton(label, aria, handler, disabled) {
    var button = el("button", { class: "btn alt", type: "button", text: label, "aria-label": aria });
    button.disabled = Boolean(disabled);
    button.addEventListener("click", handler);
    return button;
  }

  function move(list, index, delta) {
    var target = index + delta;
    if (target < 0 || target >= list.length) return false;
    list.splice(target, 0, list.splice(index, 1)[0]);
    return true;
  }

  function renderNav() {
    var holder = $("nav-editor");
    holder.replaceChildren();
    var items = content.nav_items;
    items.forEach(function (item, index) {
      var isMenu = Array.isArray(item.children);
      var row = el("div", { class: "ae-row" });
      var main = el("div", { class: "ae-line" });
      main.appendChild(textInput(item.label, "Label", "Menu item label", function (v) { item.label = v; }));
      if (!isMenu) main.appendChild(textInput(item.href, "Page or address", "Menu item address", function (v) { item.href = v; }, "page-list"));
      else main.appendChild(el("span", { class: "hint", text: "Dropdown menu" }));
      var actions = el("div", { class: "sb-actions" }, [
        smallButton("Up", "Move up", function () { if (move(items, index, -1)) { markDirty(); renderNav(); } }, index === 0),
        smallButton("Down", "Move down", function () { if (move(items, index, 1)) { markDirty(); renderNav(); } }, index === items.length - 1),
        smallButton("Remove", "Remove menu item", function () { items.splice(index, 1); markDirty(); renderNav(); })
      ]);
      if (!isMenu) actions.insertBefore(smallButton("Make dropdown", "Turn into a dropdown", function () {
        item.children = [{ label: item.label, href: item.href || "index.html" }];
        delete item.href;
        markDirty(); renderNav();
      }), actions.firstChild);
      main.appendChild(actions);
      row.appendChild(main);
      if (isMenu) {
        var sub = el("div", { class: "ae-sub" });
        item.children.forEach(function (child, childIndex) {
          var line = el("div", { class: "ae-line" });
          line.appendChild(textInput(child.label, "Label", "Sub-item label", function (v) { child.label = v; }));
          line.appendChild(textInput(child.href, "Page or address", "Sub-item address", function (v) { child.href = v; }, "page-list"));
          line.appendChild(el("div", { class: "sb-actions" }, [
            smallButton("Up", "Move up", function () { if (move(item.children, childIndex, -1)) { markDirty(); renderNav(); } }, childIndex === 0),
            smallButton("Down", "Move down", function () { if (move(item.children, childIndex, 1)) { markDirty(); renderNav(); } }, childIndex === item.children.length - 1),
            smallButton("Remove", "Remove sub-item", function () { item.children.splice(childIndex, 1); markDirty(); renderNav(); })
          ]));
          sub.appendChild(line);
        });
        sub.appendChild(smallButton("Add sub-item", "Add a sub-item", function () {
          item.children.push({ label: "", href: "" });
          markDirty(); renderNav();
        }));
        row.appendChild(sub);
      }
      holder.appendChild(row);
    });
  }

  // ---- Categories editor --------------------------------------------------

  function renderCategories() {
    var holder = $("category-editor");
    holder.replaceChildren();
    content.homepage.categories.forEach(function (category, index) {
      var thumb = category.image
        ? el("img", { class: "ae-thumb", alt: "", src: imageSrc(category.image) })
        : el("div", { class: "ae-thumb ae-empty", text: "No image" });
      var file = el("input", { type: "file", accept: "image/jpeg,image/png,image/webp", hidden: "" });
      var pick = smallButton(category.image ? "Replace image" : "Choose image", "Choose image for " + (category.label || "category"), function () { file.click(); });
      file.addEventListener("change", async function () {
        var chosen = file.files[0];
        file.value = "";
        if (!chosen) return;
        try {
          category.image = await pickImage(chosen, "category", 1800);
          markDirty();
          renderCategories();
        } catch (error) { say(error.message); }
      });
      var remove = smallButton("Remove image", "Remove image for " + (category.label || "category"), function () {
        category.image = "";
        markDirty();
        renderCategories();
      }, !category.image);
      var description = el("textarea", { rows: "3", maxlength: "400", "aria-label": "Description for " + (category.label || "category"), placeholder: "Description" });
      description.value = category.description || "";
      description.addEventListener("input", function () { category.description = description.value; markDirty(); });
      var fields = el("div", { class: "ae-fields" }, [
        textInput(category.label, "Heading", "Category heading", function (v) { category.label = v; }),
        description,
        textInput(category.cta_label, "Button label (default: See the work)", "Category button label", function (v) { category.cta_label = v; }),
        textInput(category.href, "Button link (e.g. stereo/index.html)", "Category button link", function (v) { category.href = v; }, "page-list")
      ]);
      holder.appendChild(el("div", { class: "ae-row ae-cat" }, [thumb, fields, el("div", { class: "sb-actions" }, [pick, file, remove])]));
    });
  }

  // ---- About sections editor ----------------------------------------------

  function renderSections() {
    var holder = $("section-editor");
    holder.replaceChildren();
    var sections = content.about.sections;
    sections.forEach(function (section, index) {
      var heading = textInput(section.heading, "Heading", "Section heading", function (v) { section.heading = v; });
      var body = el("textarea", { rows: "9", "aria-label": "Section text", placeholder: "Text. Leave a blank line between paragraphs." });
      body.value = section.body || "";
      body.addEventListener("input", function () { section.body = body.value; markDirty(); });
      var actions = el("div", { class: "sb-actions" }, [
        smallButton("Up", "Move section up", function () { if (move(sections, index, -1)) { markDirty(); renderSections(); } }, index === 0),
        smallButton("Down", "Move section down", function () { if (move(sections, index, 1)) { markDirty(); renderSections(); } }, index === sections.length - 1),
        smallButton("Remove", "Remove section", function () {
          if (!window.confirm("Remove this section?")) return;
          sections.splice(index, 1); markDirty(); renderSections();
        })
      ]);
      holder.appendChild(el("div", { class: "ae-row" }, [heading, body, actions]));
    });
  }

  // ---- Load / save --------------------------------------------------------

  function render() {
    fillFields();
    renderHeroSlots();
    renderNav();
    renderCategories();
    renderSections();
  }

  async function load() {
    say("Loading the site content...");
    var result = await api("/api/content");
    content = result.content;
    shop = result.shop || { title: "" };
    contentSha = result.contentSha || "";
    shopSha = result.shopSha;
    pending = {};
    render();
    markClean();
    say("");
  }

  function referencedImages() {
    var used = {};
    content.homepage.hero.slides.forEach(function (slide) { used[slide.image] = true; });
    content.homepage.categories.forEach(function (c) { used[c.image] = true; });
    return used;
  }

  async function save() {
    var used = referencedImages();
    var images = Object.keys(pending).filter(function (path) { return used[path] && !pending[path].uploaded; })
      .map(function (path) { return { path: path, data: pending[path].base64 }; });
    var button = $("save");
    button.disabled = true;
    say("Saving" + (images.length ? " (uploading " + images.length + " image" + (images.length === 1 ? "" : "s") + ")" : "") + "...");
    try {
      var result = await api("/api/content/publish", {
        method: "POST",
        body: { contentSha: contentSha, shopSha: shopSha, content: content, shop: shop, images: images }
      });
      contentSha = result.contentSha;
      shopSha = result.shopSha;
      content = result.content;
      shop = result.shop;
      Object.keys(pending).forEach(function (path) { pending[path].uploaded = true; });
      render();
      markClean();
      say("Saved. The website will update after deployment (usually under two minutes).");
    } catch (error) {
      if (error.status === 401 || error.status === 403) signedOut(error.message);
      else { say(error.message || "Could not save."); button.disabled = false; }
    }
  }

  async function resume() {
    var fragment = new URLSearchParams(window.location.hash.slice(1));
    var ticket = fragment.get("ticket");
    var authError = fragment.get("auth_error");
    if (ticket || authError) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (authError) {
      say(authError === "not_admin"
        ? "This GitHub account is not an administrator of the repository."
        : "GitHub sign-in failed during " + (fragment.get("stage") || "callback") + ": " + (fragment.get("detail") || "Please try again."));
      return;
    }
    if (!ticket) return;
    say("Finishing GitHub sign-in...");
    try {
      var handoff = await api("/api/session", { method: "POST", body: { ticket: ticket } });
      session = handoff.session;
      var me = await api("/api/me");
      setConnected(true, "Connected (" + me.role + ")");
      notifySession();
      await load();
    } catch (error) {
      signedOut(error.message || "Could not finish GitHub sign-in.");
    }
  }

  // ---- Wiring -------------------------------------------------------------

  $("github-connect").addEventListener("click", function () {
    say("Redirecting to GitHub sign-in...");
    window.location.assign(apiUrl + "/auth/start");
  });
  $("github-disconnect").addEventListener("click", async function () {
    try { if (session) await api("/api/logout", { method: "POST" }); } catch (error) { }
    signedOut("Signed out of GitHub.");
  });
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () { showTab(tab.dataset.tab); });
  });
  (function restoreTab() {
    var wanted = window.location.hash.slice(1);
    if (!/^[a-z-]+$/.test(wanted)) {
      try { wanted = sessionStorage.getItem("admin-tab") || ""; } catch (error) { wanted = ""; }
    }
    if (wanted) showTab(wanted);
  })();
  $("add-nav").addEventListener("click", function () {
    if (content.nav_items.length >= 8) { say("The menu can have up to 8 items."); return; }
    content.nav_items.push({ label: "", href: "" });
    markDirty(); renderNav();
  });
  $("add-section").addEventListener("click", function () {
    content.about.sections.push({ heading: "", body: "" });
    markDirty(); renderSections();
  });
  $("save").addEventListener("click", save);
  $("discard").addEventListener("click", async function () {
    if (dirty && !window.confirm("Discard all unsaved changes?")) return;
    try { await load(); say("Changes discarded."); }
    catch (error) { say(error.message || "Could not reload the content."); }
  });
  window.addEventListener("beforeunload", function (event) {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });

  bindFields();
  resume();
})();
