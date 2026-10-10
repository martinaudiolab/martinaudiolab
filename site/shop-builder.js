(function () {
  "use strict";

  var statusLine = document.getElementById("sb-status");
  var apiUrl = document.querySelector('meta[name="publisher-api-url"]').content.trim().replace(/\/+$/, "");
  var session = null;
  var baseSha = "";
  var data = null;             // { shop: {...}, items: [...] } being edited
  var pending = {};            // new photo path -> { base64, dataUrl }
  var dirty = false;
  var editing = null;          // { index: number|null, item: object, isNew: boolean }
  var MAX_REQUEST_BYTES = 24 * 1024 * 1024;

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

  function slugify(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
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

  // Sign-in is handled by the admin panel, which hands this builder the session.
  function signedOut(message) {
    session = null;
    data = null;
    if (window.AdminShell) window.AdminShell.expired(message);
  }

  async function loadShop() {
    say("Loading the shop...");
    var result = await api("/api/shop");
    baseSha = result.sha;
    data = { shop: result.data.shop || {}, items: Array.isArray(result.data.items) ? result.data.items : [] };
    pending = {};
    dirty = false;
    editing = null;
    $("item-editor").hidden = true;
    fillSettings();
    renderItems();
    updatePending();
    say("");
  }

  // ---- Listing ------------------------------------------------------------

  function photoSrc(path) {
    if (pending[path]) return pending[path].dataUrl;
    return path;
  }

  function priceLabel(item) {
    if (typeof item.price === "number") {
      var text = "$" + item.price.toFixed(2);
      return typeof item.was === "number" ? "$" + item.was.toFixed(2) + " → " + text : text;
    }
    return item.price ? String(item.price) : "Inquire for price";
  }

  function statusLabel(item) {
    return { available: "Available", pending: "Sale pending", sold: "Sold" }[item.status || "available"] || item.status;
  }

  function renderItems() {
    var list = $("items");
    list.replaceChildren();
    $("items-heading").textContent = "Listings (" + data.items.length + ")";
    if (!data.items.length) {
      list.appendChild(el("p", { text: "No listings yet. Select Add item to create one." }));
      return;
    }
    data.items.forEach(function (item, index) {
      var thumb = el("img", { class: "sb-thumb", alt: "", src: photoSrc((item.images && item.images[0]) || data.shop.placeholder || "images/banner.jpg") });
      var title = el("strong", { text: item.title || "(untitled)" });
      var meta = el("span", { class: "sb-meta", text: [item.category, statusLabel(item), priceLabel(item)].filter(Boolean).join("  |  ") + (item.sample ? "  |  Sample" : "") });
      var buttons = el("div", { class: "sb-actions" }, [
        action("Up", "Move up", function () { move(index, -1); }, index === 0),
        action("Down", "Move down", function () { move(index, 1); }, index === data.items.length - 1),
        action("Edit", "Edit " + item.title, function () { openEditor(index); }),
        action("Remove", "Remove " + item.title, function () { removeItem(index); })
      ]);
      list.appendChild(el("div", { class: "sb-row" }, [thumb, el("div", { class: "sb-info" }, [title, meta]), buttons]));
    });
  }

  function action(label, aria, handler, disabled) {
    var button = el("button", { class: "btn alt", type: "button", "aria-label": aria, text: label });
    button.disabled = Boolean(disabled);
    button.addEventListener("click", handler);
    return button;
  }

  function markDirty() {
    dirty = true;
    updatePending();
  }

  function updatePending() {
    $("sb-publish").disabled = !dirty;
    $("sb-discard").disabled = !dirty;
    $("pending-note").textContent = dirty ? "You have unpublished changes." : "Everything shown here is live.";
  }

  function move(index, delta) {
    var target = index + delta;
    if (target < 0 || target >= data.items.length) return;
    var moved = data.items.splice(index, 1)[0];
    data.items.splice(target, 0, moved);
    markDirty();
    renderItems();
  }

  function removeItem(index) {
    var item = data.items[index];
    if (!window.confirm("Remove \"" + item.title + "\" from the shop? This takes effect when you publish.")) return;
    data.items.splice(index, 1);
    if (editing && editing.index === index) closeEditor();
    markDirty();
    renderItems();
  }

  // ---- Shop page text -------------------------------------------------------

  function fillSettings() {
    $("set-title").value = data.shop.title || "";
    $("set-intro").value = data.shop.intro || "";
    $("set-email").value = data.shop.email || "";
  }

  function readSettings() {
    var next = {
      title: $("set-title").value.trim() || "Shop",
      intro: $("set-intro").value.trim(),
      email: $("set-email").value.trim()
    };
    var changed = ["title", "intro", "email"].some(function (key) { return (data.shop[key] || "") !== next[key]; });
    if (changed) {
      Object.assign(data.shop, next);
      markDirty();
    }
  }

  // ---- Item editor ----------------------------------------------------------

  function detailRow(label, value) {
    var row = el("div", { class: "sb-detail" });
    var labelInput = el("input", { type: "text", maxlength: "60", placeholder: "Label (e.g. Condition)", "aria-label": "Detail label" });
    var valueInput = el("input", { type: "text", maxlength: "200", placeholder: "Value", "aria-label": "Detail value" });
    labelInput.value = label || "";
    valueInput.value = value || "";
    var remove = el("button", { class: "btn alt", type: "button", text: "Remove", "aria-label": "Remove this detail" });
    remove.addEventListener("click", function () { row.remove(); });
    row.append(labelInput, valueInput, remove);
    return row;
  }

  function renderPhotos() {
    var holder = $("f-photos");
    holder.replaceChildren();
    var images = editing.item.images;
    if (!images.length) holder.appendChild(el("p", { class: "hint", text: "No photos yet. The shop will show the placeholder image." }));
    images.forEach(function (path, index) {
      var card = el("div", { class: "sb-photo" }, [
        el("img", { src: photoSrc(path), alt: "Photo " + (index + 1) }),
        el("span", { class: "sb-meta", text: index === 0 ? "Gallery photo" : "Photo " + (index + 1) })
      ]);
      var controls = el("div", { class: "sb-actions" }, [
        action("←", "Move photo earlier", function () { swapPhoto(index, -1); }, index === 0),
        action("→", "Move photo later", function () { swapPhoto(index, 1); }, index === images.length - 1),
        action("Remove", "Remove photo " + (index + 1), function () { images.splice(index, 1); renderPhotos(); })
      ]);
      card.appendChild(controls);
      holder.appendChild(card);
    });
  }

  function swapPhoto(index, delta) {
    var images = editing.item.images;
    var target = index + delta;
    if (target < 0 || target >= images.length) return;
    var moved = images.splice(index, 1)[0];
    images.splice(target, 0, moved);
    renderPhotos();
  }

  function ensureCategoryOption(value) {
    if (!value) return;
    var select = $("f-category");
    var exists = Array.from(select.options).some(function (option) { return option.value === value; });
    if (!exists) select.appendChild(el("option", { value: value, text: value }));
  }

  function openEditor(index) {
    readSettings();
    var isNew = index === null;
    var source = isNew ? { status: "available", category: "Stereo", images: [], description: [], details: [] } : data.items[index];
    editing = {
      index: index,
      isNew: isNew,
      slugTouched: false,
      item: { images: (source.images || []).slice(), sample: source.sample }
    };
    $("item-editor-title").textContent = isNew ? "Add item" : "Edit item";
    $("f-title").value = source.title || "";
    $("f-slug").value = source.slug || "";
    $("f-slug").readOnly = !isNew;
    $("slug-hint").textContent = isNew ? "Filled in from the title. Used in the page address." : "Fixed because the page already exists.";
    $("f-summary").value = source.summary || "";
    ensureCategoryOption(source.category);
    $("f-category").value = source.category || "Stereo";
    $("f-status").value = source.status || "available";
    $("f-price").value = source.price == null ? "" : String(source.price);
    $("f-was").value = typeof source.was === "number" ? String(source.was) : "";
    $("f-description").value = (source.description || []).join("\n\n");
    var details = $("f-details");
    details.replaceChildren();
    (source.details || []).forEach(function (pair) { details.appendChild(detailRow(pair[0], pair[1])); });
    $("item-error").textContent = "";
    renderPhotos();
    $("item-editor").hidden = false;
    $("f-title").focus();
    $("item-editor").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeEditor() {
    editing = null;
    $("item-editor").hidden = true;
  }

  function parsePrice(text) {
    var value = text.trim();
    if (!value) return undefined;
    var number = value.replace(/^\$/, "").replace(/,/g, "");
    if (/^\d+(\.\d{1,2})?$/.test(number)) return Number(number);
    return value;
  }

  function saveItem(event) {
    event.preventDefault();
    var error = $("item-error");
    var title = $("f-title").value.trim();
    var slug = $("f-slug").value.trim();
    if (!title) { error.textContent = "Add a title."; return; }
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug === "index") {
      error.textContent = "The page name must be lowercase letters, numbers and hyphens, such as marantz-2270.";
      return;
    }
    var clash = data.items.some(function (other, i) { return other.slug === slug && i !== editing.index; });
    if (clash) { error.textContent = "Another listing already uses that page name."; return; }

    var item = {
      slug: slug,
      title: title,
      summary: $("f-summary").value.trim(),
      category: $("f-category").value,
      status: $("f-status").value,
      images: editing.item.images.slice()
    };
    var price = parsePrice($("f-price").value);
    if (price !== undefined) item.price = price;
    var wasText = $("f-was").value.trim();
    if (wasText) {
      var was = parsePrice(wasText);
      if (typeof was !== "number") { error.textContent = "The previous price must be a number."; return; }
      if (typeof price !== "number") { error.textContent = "A previous price needs a numeric price too."; return; }
      item.was = was;
    }
    var details = Array.from($("f-details").children).map(function (row) {
      var inputs = row.querySelectorAll("input");
      return [inputs[0].value.trim(), inputs[1].value.trim()];
    }).filter(function (pair) { return pair[0]; });
    if (details.length) item.details = details;
    item.description = $("f-description").value.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    if (editing.item.sample) item.sample = true;

    if (editing.isNew) data.items.unshift(item);
    else data.items[editing.index] = item;
    closeEditor();
    markDirty();
    renderItems();
    say("Saved \"" + title + "\". Publish when you are ready.");
  }

  // ---- Photos -------------------------------------------------------------

  function resizePhoto(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () {
        URL.revokeObjectURL(url);
        var scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
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

  async function addPhotos(files) {
    var error = $("item-error");
    error.textContent = "";
    for (var i = 0; i < files.length; i++) {
      if (editing.item.images.length >= 12) { error.textContent = "An item can have up to 12 photos."; break; }
      try {
        var source = window.HeicSupport ? await window.HeicSupport.prepare(files[i]) : files[i];
        var photo = await resizePhoto(source);
        if (photo.base64.length * 0.75 > 3_500_000) throw new Error(files[i].name + " is too large even after resizing.");
        var path = "images/shop/photo-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6) + ".jpg";
        pending[path] = photo;
        editing.item.images.push(path);
      } catch (problem) {
        error.textContent = problem.message;
      }
    }
    renderPhotos();
  }

  // ---- Publish --------------------------------------------------------------

  function referencedPaths() {
    var used = {};
    data.items.forEach(function (item) { (item.images || []).forEach(function (path) { used[path] = true; }); });
    return used;
  }

  async function publish() {
    readSettings();
    var used = referencedPaths();
    var images = Object.keys(pending).filter(function (path) { return used[path] && !pending[path].uploaded; })
      .map(function (path) { return { path: path, data: pending[path].base64 }; });
    var bytes = images.reduce(function (sum, image) { return sum + image.data.length; }, 0);
    if (bytes > MAX_REQUEST_BYTES) {
      say("These photos are too large to publish at once. Publish a few items at a time.");
      return;
    }
    var button = $("sb-publish");
    button.disabled = true;
    say("Publishing" + (images.length ? " (uploading " + images.length + " photo" + (images.length === 1 ? "" : "s") + ")" : "") + "...");
    try {
      var result = await api("/api/shop/publish", {
        method: "POST",
        body: { baseSha: baseSha, data: data, images: images }
      });
      baseSha = result.sha;
      data = { shop: result.data.shop, items: result.data.items };
      // Keep the previews so thumbnails stay visible until the site finishes deploying.
      Object.keys(pending).forEach(function (path) { pending[path].uploaded = true; });
      dirty = false;
      fillSettings();
      renderItems();
      say("Published. The website will update after deployment (usually under two minutes).");
    } catch (error) {
      if (error.status === 401 || error.status === 403) signedOut(error.message);
      else say(error.message || "Could not publish the shop.");
    } finally {
      updatePending();
    }
  }

  async function discard() {
    if (!window.confirm("Discard all unpublished changes?")) return;
    try { await loadShop(); say("Changes discarded."); }
    catch (error) { say(error.message || "Could not reload the shop."); }
  }

  // ---- Wiring ---------------------------------------------------------------

  if (window.AdminShell) window.AdminShell.onSession(function (token) {
    session = token;
    if (!token) {
      data = null;
      dirty = false;
      $("items").replaceChildren();
      return;
    }
    loadShop().catch(function (error) { say(error.message || "Could not load the shop."); });
  });
  $("add-item").addEventListener("click", function () { openEditor(null); });
  $("toggle-settings").addEventListener("click", function () {
    var panel = $("settings-panel");
    panel.hidden = !panel.hidden;
    this.setAttribute("aria-expanded", String(!panel.hidden));
  });
  $("settings-done").addEventListener("click", function () {
    readSettings();
    $("settings-panel").hidden = true;
    $("toggle-settings").setAttribute("aria-expanded", "false");
  });
  $("item-form").addEventListener("submit", saveItem);
  $("item-cancel").addEventListener("click", closeEditor);
  $("f-title").addEventListener("input", function () {
    if (editing && editing.isNew && !editing.slugTouched) $("f-slug").value = slugify($("f-title").value);
  });
  $("f-slug").addEventListener("input", function () { if (editing) editing.slugTouched = true; });
  $("add-detail").addEventListener("click", function () { $("f-details").appendChild(detailRow("", "")); });
  $("add-photos").addEventListener("click", function () { $("photo-file").click(); });
  $("photo-file").addEventListener("change", async function (event) {
    var files = Array.from(event.target.files || []);
    event.target.value = "";
    if (files.length && editing) await addPhotos(files);
  });
  $("sb-publish").addEventListener("click", publish);
  $("sb-discard").addEventListener("click", discard);
  window.addEventListener("beforeunload", function (event) {
    if (dirty) { event.preventDefault(); event.returnValue = ""; }
  });

})();
