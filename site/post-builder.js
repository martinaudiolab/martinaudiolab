(function () {
  "use strict";

  var categories = {
    stereo: { folder: "stereo", name: "Stereo Repair" },
    radio: { folder: "radio", name: "Radio Repair" },
    "test-equipment": { folder: "test-equipment", name: "Test Equipment" }
  };
  var form = document.getElementById("post-form");
  var editor = document.getElementById("post-content");
  var status = document.getElementById("status");
  var selectedImage = null;
  var savedRange = null;
  var publisherApiUrl = document.querySelector('meta[name="publisher-api-url"]').content.trim().replace(/\/+$/, "");
  var publisherSession = null;
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

  function currentCategory() {
    return categories[document.getElementById("category").value];
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

  function navHtml(activeKey) {
    var links = [
      ["../index.html", "Home", ""],
      ["../stereo/index.html", "Stereo Repair", "stereo"],
      ["../radio/index.html", "Radio Repair", "radio"],
      ["../test-equipment/index.html", "Test Equipment", "test-equipment"],
      ["../contact.html", "Contact", ""]
    ];
    return links.map(function (link) {
      return '<a href="' + link[0] + '"' + (link[2] === activeKey ? ' class="on" aria-current="page"' : "") + ">" + link[1] + "</a>";
    }).join("");
  }

  function themeScript() {
    return '<script>(function(){var r=document.documentElement;try{var t=localStorage.getItem("th");if(t)r.setAttribute("data-theme",t)}catch(e){}document.getElementById("th").onclick=function(){var d=r.getAttribute("data-theme")==="dark"||(!r.getAttribute("data-theme")&&matchMedia("(prefers-color-scheme:dark)").matches),n=d?"light":"dark";r.setAttribute("data-theme",n);try{localStorage.setItem("th",n)}catch(e){}}})()<\/script>';
  }

  function articleHtml(data) {
    var categoryLink = "index.html";
    return '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>' + escapeHtml(data.title) + ' - Martin Audio Labs</title><meta name="description" content="' + escapeHtml(data.summary) + '"><link rel="stylesheet" href="../style.css"></head><body><header class="site"><a class="brand" href="../index.html">Martin Audio Labs</a><nav>' + navHtml(data.categoryKey) + '<button class="theme" type="button" id="th">Theme</button></nav></header><main><a class="back" href="' + categoryLink + '">Back to ' + escapeHtml(data.category.name) + '</a><article class="post"><h1 class="post-title">' + escapeHtml(data.title) + '</h1><div class="meta">' + escapeHtml(dateLabel(data.date)) + ' &nbsp;|&nbsp; <a href="index.html">' + escapeHtml(data.category.name) + '</a></div><div class="body">' + data.content + '</div></article></main>' + themeScript() + '</body></html>\n';
  }

  function listingHtml(data) {
    return '<article class="post"><h2><a href="' + escapeHtml(data.slug) + '.html">' + escapeHtml(data.title) + '</a></h2><div class="meta">' + escapeHtml(dateLabel(data.date)) + ' &nbsp;|&nbsp; <a href="index.html">' + escapeHtml(data.category.name) + '</a></div><div class="body"><p>' + escapeHtml(data.summary) + '</p></div><a class="more" href="' + escapeHtml(data.slug) + '.html">Read the post</a></article>';
  }

  function updatedIndexHtml(indexHtml, data) {
    var parsed = new DOMParser().parseFromString(indexHtml, "text/html");
    var main = parsed.querySelector("main");
    if (!main || !main.querySelector(".intro")) throw new Error("The selected file is not a section index page.");
    var template = document.createElement("template");
    template.innerHTML = listingHtml(data);
    main.querySelector(".intro").after(template.content.firstElementChild);
    return "<!DOCTYPE html>\n" + parsed.documentElement.outerHTML;
  }

  function download(name, content) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([content], { type: "text/html;charset=utf-8" }));
    link.download = name;
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); }, 1000);
  }

  async function downloadFiles(data) {
    var file = document.getElementById("section-index").files[0];
    if (!file) throw new Error("Choose the current section index file first so its post list can be updated.");
    var indexHtml = await file.text();
    var indexOutput = updatedIndexHtml(indexHtml, data);
    download(data.slug + ".html", articleHtml(data));
    download("index.html", indexOutput);
    status.textContent = "Downloaded the post and updated section index. Place both files in the " + data.category.folder + " folder.";
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

  function updateGitHubStatus(message, connected) {
    document.getElementById("github-status").textContent = message;
    document.getElementById("github-connect").hidden = connected;
    document.getElementById("github-disconnect").hidden = !connected;
    document.getElementById("publish").disabled = !connected;
  }

  async function connectGitHub() {
    if (!publisherApiUrl || publisherApiUrl.indexOf("REPLACE_WITH_WORKER") !== -1) {
      status.textContent = "Set the publisher Worker URL in post-builder.html before connecting.";
      return;
    }
    status.textContent = "Redirecting to GitHub sign-in...";
    window.location.assign(publisherApiUrl + "/auth/start");
  }

  async function resumeGitHubSession() {
    var fragment = new URLSearchParams(window.location.hash.slice(1));
    var ticket = fragment.get("ticket");
    var authError = fragment.get("auth_error");
    if (ticket || authError) window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (authError) {
      status.textContent = authError === "not_admin"
        ? "Repository owner: " + (fragment.get("owner") || "unknown") + "; admin: " + fragment.get("admin") + "; push: " + fragment.get("push") + "."
        : "GitHub sign-in failed during " + (fragment.get("stage") || "callback") + " (HTTP " + (fragment.get("status") || "unknown") + "): " + (fragment.get("detail") || "Please try again.");
      return;
    }
    if (!ticket) return;

    status.textContent = "Finishing GitHub sign-in...";
    try {
      var handoff = await publisherApi("/api/session", { method: "POST", body: { ticket: ticket } });
      publisherSession = handoff.session;
      var user = await publisherApi("/api/me");
      updateGitHubStatus("Connected (" + user.role + ")", true);
      status.textContent = "GitHub publishing is ready.";
    } catch (error) {
      publisherSession = null;
      updateGitHubStatus("GitHub sign-in required", false);
      status.textContent = error.message || "Could not finish GitHub sign-in.";
    }
  }

  async function disconnectGitHub() {
    try {
      if (publisherSession) await publisherApi("/api/logout", { method: "POST" });
    } catch (error) { }
    publisherSession = null;
    updateGitHubStatus("GitHub sign-in required", false);
    status.textContent = "Signed out of GitHub.";
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

    var publishButton = document.getElementById("publish");
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
  var githubConnectButton = document.getElementById("github-connect");
  var githubSetupHint = document.getElementById("github-setup-hint");
  if (!publisherApiUrl || publisherApiUrl.indexOf("REPLACE_WITH_WORKER") !== -1) {
    githubConnectButton.disabled = true;
    document.getElementById("github-status").textContent = "Publisher Worker is not configured";
  } else {
    githubSetupHint.textContent = "Sign in with a GitHub administrator account to publish directly to the website.";
  }
  githubConnectButton.addEventListener("click", connectGitHub);
  document.getElementById("github-disconnect").addEventListener("click", disconnectGitHub);
  resumeGitHubSession();

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
  document.getElementById("publish").addEventListener("click", publish);
  document.getElementById("download").addEventListener("click", async function () {
    if (!form.reportValidity()) return;
    var data = postData();
    if (!data.slug || !data.content.trim()) { status.textContent = "Add a title and post content before downloading."; return; }
    try { await downloadFiles(data); }
    catch (error) { status.textContent = error.message; }
  });
})();
