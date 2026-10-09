(function () {
  "use strict";
  var overlay = null;

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
  }

  function onKey(event) { if (event.key === "Escape") close(); }

  function open(source) {
    close();
    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    var image = document.createElement("img");
    image.src = source.currentSrc || source.src;
    image.alt = source.alt || "";
    var button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Close image");
    button.textContent = "×";
    overlay.append(image, button);
    overlay.addEventListener("click", close);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
  }

  document.addEventListener("click", function (event) {
    var image = event.target.closest && event.target.closest(".post .body img");
    if (image) open(image);
  });
})();
