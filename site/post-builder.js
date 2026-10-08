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
  var siteRootDirectory = null;
  var destinationDirectory = null;
  var destinationCategoryKey = null;
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

  async function writeFile(directory, name, content) {
    var handle = await directory.getFileHandle(name, { create: true });
    var writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async function verifySectionFolder(root, categoryKey) {
    var category = categories[categoryKey];
    var directory;
    try {
      directory = await root.getDirectoryHandle(category.folder);
    } catch (error) {
      if (error.name === "NotFoundError") {
        throw new Error("The selected site folder does not contain " + category.folder + ". Choose the folder that contains all three repair folders.");
      }
      throw error;
    }
    var indexHandle = await directory.getFileHandle("index.html");
    var indexFile = await indexHandle.getFile();
    var parsed = new DOMParser().parseFromString(await indexFile.text(), "text/html");
    var main = parsed.querySelector("main");
    var heading = main && main.querySelector("h1");
    if (!main || !main.querySelector(".intro") || !heading || heading.textContent.trim() !== category.name) {
      throw new Error("The " + category.folder + " folder does not contain the " + category.name + " section page.");
    }
    destinationDirectory = directory;
    destinationCategoryKey = categoryKey;
    document.getElementById("folder-name").textContent = "Ready: " + category.folder;
    document.getElementById("publish").disabled = false;
    return directory;
  }

  async function chooseSiteFolder() {
    if (typeof window.showDirectoryPicker !== "function") {
      status.textContent = "This browser cannot write to folders directly. Open Use downloads instead to publish with downloaded files.";
      return;
    }
    try {
      var categoryKey = document.getElementById("category").value;
      var directory = await window.showDirectoryPicker({ mode: "readwrite" });
      await verifySectionFolder(directory, categoryKey);
      siteRootDirectory = directory;
      status.textContent = "Site folder verified. The selected section folder is " + categories[categoryKey].folder + ". Select Publish post when ready.";
    } catch (error) {
      if (error.name === "AbortError") return;
      siteRootDirectory = null;
      destinationDirectory = null;
      destinationCategoryKey = null;
      document.getElementById("folder-name").textContent = "No site folder selected";
      document.getElementById("publish").disabled = true;
      status.textContent = error.message || "Could not access that folder. Check permissions and try again.";
    }
  }

  async function publish() {
    if (!form.reportValidity()) return;
    var data = postData();
    if (!data.slug) { status.textContent = "Add a title with at least one letter or number."; return; }
    if (!data.content.trim()) { status.textContent = "Add some post content before publishing."; return; }
    if (!siteRootDirectory) {
      status.textContent = "Choose the site folder before publishing.";
      document.getElementById("publish").disabled = true;
      return;
    }
    if (!destinationDirectory || destinationCategoryKey !== data.categoryKey) {
      try { await verifySectionFolder(siteRootDirectory, data.categoryKey); }
      catch (error) { status.textContent = error.message; return; }
    }

    var wrotePost = false;
    var filename = data.slug + ".html";
    try {
      if (typeof destinationDirectory.requestPermission === "function") {
        var permission = await destinationDirectory.requestPermission({ mode: "readwrite" });
        if (permission !== "granted") throw new Error("Write permission was not granted. Choose the section folder again and allow editing.");
      }
      var indexHandle = await destinationDirectory.getFileHandle("index.html");
      var indexFile = await indexHandle.getFile();
      var indexOutput = updatedIndexHtml(await indexFile.text(), data);
      var parsedIndex = new DOMParser().parseFromString(indexOutput, "text/html");
      if (parsedIndex.querySelector("main h1")?.textContent.trim() !== data.category.name) {
        throw new Error("The selected section index no longer matches " + data.category.name + ". Choose the section folder again.");
      }
      try {
        await destinationDirectory.getFileHandle(filename);
        throw new Error("A post with this title already exists. Change the title to make a unique filename.");
      } catch (error) {
        if (error.name !== "NotFoundError") throw error;
      }
      status.textContent = "Publishing " + filename + "...";
      await writeFile(destinationDirectory, filename, articleHtml(data));
      wrotePost = true;
      await writeFile(destinationDirectory, "index.html", indexOutput);
      status.textContent = "Published " + filename + " in " + data.category.folder + "; the section page now links to it.";
      try { localStorage.removeItem(draftKey); } catch (ignored) { }
    } catch (error) {
      if (wrotePost) {
        try { await destinationDirectory.removeEntry(filename); } catch (ignored) { }
      }
      if (error.name === "AbortError") return;
      status.textContent = error.message || "Could not publish. Re-select the section folder and verify write permission.";
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
  document.getElementById("choose-folder").addEventListener("click", chooseSiteFolder);
  document.getElementById("category").addEventListener("change", async function () {
    destinationDirectory = null;
    destinationCategoryKey = null;
    document.getElementById("folder-name").textContent = siteRootDirectory ? "Checking section folder..." : "No site folder selected";
    document.getElementById("publish").disabled = true;
    if (!siteRootDirectory) {
      status.textContent = "Section changed. Choose the site folder to enable publishing.";
      return;
    }
    try {
      await verifySectionFolder(siteRootDirectory, document.getElementById("category").value);
      status.textContent = "Section folder selected automatically: " + categories[document.getElementById("category").value].folder + ".";
    } catch (error) {
      document.getElementById("folder-name").textContent = "Section folder unavailable";
      status.textContent = error.message;
    }
  });

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
    siteRootDirectory = null;
    destinationDirectory = null;
    destinationCategoryKey = null;
    document.getElementById("folder-name").textContent = "No site folder selected";
    document.getElementById("publish").disabled = true;
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
