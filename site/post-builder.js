(function () {
  "use strict";

  var categories = {
    stereo: { folder: "stereo", name: "Stereo Repair" },
    radio: { folder: "radio", name: "Radio Repair" },
    "test-equipment": { folder: "test-equipment", name: "Test Equipment" }
  };
  var form = document.getElementById("post-form");
  var editor = document.getElementById("post-content");
  var status = document.getElementById("pb-status");
  var selectedImage = null;
  var savedRange = null;
  var publisherApiUrl = document.querySelector('meta[name="publisher-api-url"]').content.trim().replace(/\/+$/, "");
  var publisherSession = null;
  var managedIndexSnapshot = null;
  var draftKey = "martin-audio-labs-post-draft";
  var allowedTags = new Set(["A", "BLOCKQUOTE", "BR", "CODE", "EM", "FIGURE", "H2", "H3", "H4", "HR", "IMG", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "U", "UL"]);

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function cleanHtml(html) {
    var template = document.createElement("template");
    template.innerHTML = html;
    Array.from(template.content.querySelectorAll("script,style,iframe,object,embed,svg,math,form,video,audio"))
      .forEach(function (element) { element.remove(); });

    function cleanNode(node) {
      Array.from(node.children || []).forEach(function (element) {
        cleanNode(element);
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith.apply(element, Array.from(element.childNodes));
          return;
        }
        Array.from(element.attributes).forEach(function (attribute) {
          var name = attribute.name.toLowerCase();
          var value = attribute.value;
          if (element.tagName === "A" && name === "href") {
            try {
              var url = new URL(value, window.location.href);
              if (!["http:", "https:", "mailto:"].includes(url.protocol) && value.charAt(0) !== "#") element.removeAttribute(name);
            } catch (error) { element.removeAttribute(name); }
          } else if (element.tagName === "IMG" && name === "src") {
            if (!/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) element.removeAttribute(name);
            else return;
          } else if (element.tagName === "IMG" && name === "alt") {
            return;
          } else if (element.tagName === "IMG" && name === "data-w" && ["25", "50", "75", "100"].includes(value)) {
            return;
          } else if (element.tagName === "IMG" && name === "data-a" && ["c", "l", "r"].includes(value)) {
            return;
          } else if (element.tagName === "SPAN" && name === "style") {
            var styles = [];
            var size = parseInt(element.style.fontSize, 10);
            if (size >= 10 && size <= 72) styles.push("font-size: " + size + "px");
            var color = element.style.color;
            if (/^#[0-9a-f]{3,8}$/i.test(color)) styles.push("color: " + color);
            else {
              var rgb = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i);
              if (rgb && rgb.slice(1).every(function (component) { return Number(component) <= 255; })) {
                styles.push("color: rgb(" + rgb.slice(1).join(", ") + ")");
              }
            }
            if (styles.length) element.setAttribute("style", styles.join("; "));
            else element.removeAttribute("style");
            if (styles.length) return;
          }
          element.removeAttribute(name);
        });
        if (element.tagName === "IMG" && !element.hasAttribute("src")) element.remove();
      });
    }
    cleanNode(template.content);
    return template.innerHTML;
  }

  function slugify(value) {
    return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  }

  function dateLabel(value) {
    var date = new Date(value + "T00:00:00Z");
    return new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
  }

  function postData() {
    var data = {
      categoryKey: document.getElementById("category").value,
      title: document.getElementById("post-title").value.trim(),
      summary: document.getElementById("post-summary").value.trim(),
      date: document.getElementById("post-date").value,
      content: cleanHtml(editor.innerHTML)
    };
    data.category = categories[data.categoryKey];
    data.slug = slugify(data.title);
    return data;
  }

  async function publisherApi(path, options) {
    var request = Object.assign({}, options || {});
    request.headers = Object.assign({ Accept: "application/json" }, request.headers || {});
    if (publisherSession) request.headers.Authorization = "Bearer " + publisherSession;
    if (request.body && typeof request.body !== "string") {
      request.headers["Content-Type"] = "application/json";
      request.body = JSON.stringify(request.body);
    }
    var response = await fetch(publisherApiUrl + path, request);
    var result = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(result.error || "Publisher returned HTTP " + response.status + ".");
      error.status = response.status;
      throw error;
    }
    return result;
  }

  // Sign-in is handled by the admin panel, which hands this builder the session.
  function applySession(session) {
    publisherSession = session;
    document.getElementById("pb-publish").disabled = !session;
    document.getElementById("manage-posts-toolbar").hidden = !session;
    if (!session) {
      document.getElementById("post-manager").hidden = true;
      document.getElementById("manage-posts-toggle").setAttribute("aria-expanded", "false");
    }
  }

  function updateGitHubStatus(message) {
    if (window.AdminShell) window.AdminShell.expired(message);
  }

  async function publish() {
    if (!form.reportValidity()) return;
    if (!publisherSession) {
      status.textContent = "Connect an administrator GitHub account before publishing.";
      return;
    }
    var data = postData();
    if (!data.slug) { status.textContent = "Add a title with at least one letter or number."; return; }
    if (!data.content.trim()) { status.textContent = "Add some post content before publishing."; return; }

    var publishButton = document.getElementById("pb-publish");
    publishButton.disabled = true;
    try {
      status.textContent = "Publishing to GitHub...";
      var result = await publisherApi("/api/publish", {
        method: "POST",
        body: {
          category: data.categoryKey,
          title: data.title,
          summary: data.summary,
          date: data.date,
          content: data.content
        }
      });
      status.textContent = "Published " + result.filename + " to " + result.section + ". The website will update after deployment.";
      try { localStorage.removeItem(draftKey); } catch (ignored) { }
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        publisherSession = null;
        updateGitHubStatus("GitHub sign-in required", false);
      }
      status.textContent = error.message || "Could not publish to GitHub.";
    } finally {
      publishButton.disabled = !publisherSession;
    }
  }

  function postsFromIndex(indexHtml) {
    var parsed = new DOMParser().parseFromString(indexHtml, "text/html");
    return Array.from(parsed.querySelectorAll("main article.post")).map(function (article) {
      var link = article.querySelector("h2 a[href]");
      if (!link) return null;
      var filename = link.getAttribute("href");
      var match = filename.match(/^([a-z0-9]+(?:-[a-z0-9]+)*)\.html$/);
      if (!match) return null;
      return { slug: match[1], title: link.textContent.trim() };
    }).filter(Boolean);
  }

  function indexWithoutPost(indexHtml, slug) {
    var parsed = new DOMParser().parseFromString(indexHtml, "text/html");
    var matches = Array.from(parsed.querySelectorAll("main article.post")).filter(function (article) {
      var link = article.querySelector("h2 a[href]");
      return link && link.getAttribute("href") === slug + ".html";
    });
    if (matches.length !== 1) throw new Error("Could not find exactly one matching post in this section. Refresh the list and try again.");
    matches[0].remove();
    return "<!DOCTYPE html>\n" + parsed.documentElement.outerHTML;
  }

  function renderManagedPosts(indexHtml) {
    var list = document.getElementById("managed-posts");
    var posts = postsFromIndex(indexHtml);
    list.replaceChildren();
    if (!posts.length) {
      list.textContent = "No posts found in this section.";
      return 0;
    }
    posts.forEach(function (post) {
      var row = document.createElement("div");
      row.className = "managed-post";
      var title = document.createElement("span");
      title.textContent = post.title;
      var button = document.createElement("button");
      button.className = "btn alt";
      button.type = "button";
      button.textContent = "Delete";
      button.setAttribute("aria-label", "Delete " + post.title);
      button.addEventListener("click", function () { deleteManagedPost(post); });
      row.append(title, button);
      list.appendChild(row);
    });
    return posts.length;
  }

  async function loadManagedPosts() {
    var manageStatus = document.getElementById("manage-status");
    var category = document.getElementById("manage-category").value;
    manageStatus.textContent = "Loading posts...";
    document.getElementById("managed-posts").textContent = "";
    try {
      managedIndexSnapshot = await publisherApi("/api/posts?category=" + encodeURIComponent(category));
      var count = renderManagedPosts(managedIndexSnapshot.indexHtml);
      manageStatus.textContent = count ? count + " post" + (count === 1 ? "" : "s") + " loaded." : "";
    } catch (error) {
      managedIndexSnapshot = null;
      manageStatus.textContent = error.message || "Could not load posts.";
    }
  }

  async function deleteManagedPost(post) {
    if (!publisherSession || !managedIndexSnapshot) return;
    var category = document.getElementById("manage-category").value;
    if (!window.confirm("Permanently delete \"" + post.title + "\" and remove it from this section?")) return;
    var manageStatus = document.getElementById("manage-status");
    manageStatus.textContent = "Deleting " + post.title + "...";
    try {
      var updatedIndex = indexWithoutPost(managedIndexSnapshot.indexHtml, post.slug);
      var result = await publisherApi("/api/delete", {
        method: "POST",
        body: {
          category: category,
          slug: post.slug,
          indexSha: managedIndexSnapshot.indexSha,
          indexHtml: updatedIndex
        }
      });
      await loadManagedPosts();
      manageStatus.textContent = "Deleted " + result.filename + " from " + result.section + ". The website will update after deployment.";
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        publisherSession = null;
        updateGitHubStatus("GitHub sign-in required", false, false);
      }
      manageStatus.textContent = error.message || "Could not delete that post.";
    }
  }

  function saveDraft() {
    var draft = {
      category: document.getElementById("category").value,
      title: document.getElementById("post-title").value,
      summary: document.getElementById("post-summary").value,
      date: document.getElementById("post-date").value,
      content: editor.innerHTML
    };
    try { localStorage.setItem(draftKey, JSON.stringify(draft)); status.textContent = "Draft saved in this browser."; }
    catch (error) { status.textContent = "Draft could not be saved in this browser."; }
  }

  function loadDraft() {
    try {
      var draft = JSON.parse(localStorage.getItem(draftKey) || "null");
      if (!draft) return;
      if (categories[draft.category]) document.getElementById("category").value = draft.category;
      document.getElementById("post-title").value = draft.title || "";
      document.getElementById("post-summary").value = draft.summary || "";
      document.getElementById("post-date").value = draft.date || "";
      editor.innerHTML = cleanHtml(draft.content || "");
      status.textContent = "Restored the saved draft from this browser.";
    } catch (error) { localStorage.removeItem(draftKey); }
  }

  function restoreSelection() {
    editor.focus();
    if (!savedRange) return;
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(savedRange);
  }

  document.addEventListener("selectionchange", function () {
    var selection = window.getSelection();
    if (selection.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
  });

  document.getElementById("post-date").value = new Date().toISOString().slice(0, 10);
  loadDraft();
  document.getElementById("manage-posts-toggle").addEventListener("click", function () {
    var panel = document.getElementById("post-manager");
    panel.hidden = !panel.hidden;
    this.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) loadManagedPosts();
  });
  document.getElementById("manage-category").addEventListener("change", loadManagedPosts);
  document.getElementById("refresh-posts").addEventListener("click", loadManagedPosts);
  if (window.AdminShell) window.AdminShell.onSession(applySession);

  document.querySelectorAll("[data-command]").forEach(function (button) {
    button.addEventListener("mousedown", function (event) { event.preventDefault(); });
    button.addEventListener("click", function () {
      restoreSelection();
      document.execCommand(button.dataset.command, false, null);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
    });
  });

  document.getElementById("apply-block").addEventListener("click", function () {
    restoreSelection();
    document.execCommand("formatBlock", false, "<" + document.getElementById("block-style").value + ">");
  });
  document.getElementById("apply-size").addEventListener("click", function () {
    var size = Math.max(10, Math.min(72, parseInt(document.getElementById("font-size").value, 10) || 18));
    document.getElementById("font-size").value = size;
    restoreSelection();
    document.execCommand("fontSize", false, "7");
    editor.querySelectorAll('font[size="7"]').forEach(function (font) {
      var span = document.createElement("span");
      span.style.fontSize = size + "px";
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  document.getElementById("text-color").addEventListener("input", function (event) {
    restoreSelection();
    document.execCommand("foreColor", false, event.target.value);
    editor.querySelectorAll("font[color]").forEach(function (font) {
      var color = font.getAttribute("color");
      if (!/^#[0-9a-f]{3,8}$/i.test(color)) return;
      var span = document.createElement("span");
      span.style.color = color;
      span.innerHTML = font.innerHTML;
      font.replaceWith(span);
    });
    editor.dispatchEvent(new Event("input", { bubbles: true }));
  });
  document.getElementById("apply-block").addEventListener("mousedown", function (event) { event.preventDefault(); });
  document.getElementById("apply-size").addEventListener("mousedown", function (event) { event.preventDefault(); });
  document.getElementById("add-link").addEventListener("mousedown", function (event) { event.preventDefault(); });
  document.getElementById("add-link").addEventListener("click", function () {
    var url = window.prompt("Enter a web or email link:");
    if (!url) return;
    if (!/^(https?:\/\/|mailto:)/i.test(url)) url = "https://" + url;
    restoreSelection();
    document.execCommand("createLink", false, url);
  });

  document.getElementById("add-image").addEventListener("mousedown", function (event) {
    event.preventDefault();
    var selection = window.getSelection();
    savedRange = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
  });
  document.getElementById("add-image").addEventListener("click", function () { document.getElementById("image-file").click(); });
  document.getElementById("image-file").addEventListener("change", function (event) {
    var file = event.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      restoreSelection();
      document.execCommand("insertHTML", false, '<img src="' + reader.result + '" alt="" data-w="100" data-a="c">');
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      event.target.value = "";
    };
    reader.readAsDataURL(file);
  });

  editor.addEventListener("click", function (event) {
    if (selectedImage) selectedImage.classList.remove("sel");
    selectedImage = event.target.closest("img");
    var tools = document.getElementById("image-tools");
    tools.hidden = !selectedImage;
    if (!selectedImage) return;
    selectedImage.classList.add("sel");
    document.getElementById("image-width").value = selectedImage.dataset.w || "100";
    document.getElementById("image-align").value = selectedImage.dataset.a || "c";
    document.getElementById("image-alt").value = selectedImage.alt || "";
  });
  document.getElementById("image-width").addEventListener("change", function (event) {
    if (selectedImage) selectedImage.dataset.w = event.target.value;
  });
  document.getElementById("image-align").addEventListener("change", function (event) {
    if (selectedImage) selectedImage.dataset.a = event.target.value;
  });
  document.getElementById("image-alt").addEventListener("input", function (event) {
    if (selectedImage) selectedImage.alt = event.target.value;
  });
  document.getElementById("remove-image").addEventListener("click", function () {
    if (selectedImage) selectedImage.remove();
    selectedImage = null;
    document.getElementById("image-tools").hidden = true;
  });

  document.getElementById("preview-toggle").addEventListener("click", function (event) {
    var preview = document.getElementById("preview");
    if (preview.hidden) {
      var data = postData();
      preview.innerHTML = '<h2>' + escapeHtml(data.title || "Post preview") + '</h2><div class="meta">' + (data.date ? escapeHtml(dateLabel(data.date)) : "") + ' &nbsp;|&nbsp; ' + escapeHtml(data.category.name) + '</div><div class="body">' + data.content + '</div>';
      preview.hidden = false;
      event.target.textContent = "Hide preview";
    } else {
      preview.hidden = true;
      event.target.textContent = "Preview";
    }
  });

  document.getElementById("save-draft").addEventListener("click", saveDraft);
  document.getElementById("clear-draft").addEventListener("click", function () {
    try { localStorage.removeItem(draftKey); } catch (error) { }
    form.reset();
    document.getElementById("post-date").value = new Date().toISOString().slice(0, 10);
    editor.innerHTML = "<p></p>";
    document.getElementById("preview").hidden = true;
    document.getElementById("preview-toggle").textContent = "Preview";
    status.textContent = "Draft cleared.";
  });
  document.getElementById("pb-publish").addEventListener("click", publish);
})();
