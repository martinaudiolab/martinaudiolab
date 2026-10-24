// Click a photo in a post or the shop to see it enlarged. Photos in a gallery grid, and all of a
// shop listing's photos, can be stepped through with the arrows on screen or the left/right keys.
// On a shop listing the thumbnails under the large photo swap it.
(function () {
  "use strict";
  var overlay = null;

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
  }

  var step = null;   // moves to the previous (-1) or next (+1) photo of the open gallery

  function onKey(event) {
    if (event.key === "Escape") close();
    else if (step && event.key === "ArrowLeft") step(-1);
    else if (step && event.key === "ArrowRight") step(1);
  }

  function open(source) {
    close();
    var figure = source.closest && source.closest("figure[data-gallery]");
    var group = figure ? Array.prototype.slice.call(figure.querySelectorAll("img")) : [source];
    var index = Math.max(0, group.indexOf(source));
    // a shop listing's large photo: step through all of its photos, starting at the one shown
    var shop = source.closest && source.closest(".shop-gallery");
    var thumbs = shop ? Array.prototype.slice.call(shop.querySelectorAll(".shop-thumb")) : [];
    if (thumbs.length) {
      group = thumbs.map(function (thumb) { return thumb.querySelector("img"); });
      index = Math.max(0, thumbs.findIndex(function (thumb) { return thumb.classList.contains("on"); }));
    }

    overlay = document.createElement("div");
    overlay.className = "lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    var image = document.createElement("img");
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.setAttribute("aria-label", "Close image");
    closeButton.textContent = "×";
    overlay.append(image, closeButton);

    function show() {
      var current = group[index];
      image.src = current.currentSrc || current.src;
      image.alt = current.alt || "";
    }

    step = null;
    if (group.length > 1) {
      step = function (delta) {
        index = (index + delta + group.length) % group.length;
        show();
      };
      [["prev", "‹", -1, "Previous photo"], ["next", "›", 1, "Next photo"]].forEach(function (spec) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "lb-nav lb-" + spec[0];
        button.setAttribute("aria-label", spec[3]);
        button.textContent = spec[1];
        button.addEventListener("click", function (event) {
          event.stopPropagation();    // the overlay closes on any other click
          step(spec[2]);
        });
        overlay.appendChild(button);
      });
    }

    show();
    overlay.addEventListener("click", close);
    document.body.appendChild(overlay);
    document.addEventListener("keydown", onKey);
  }

  // A shop listing's thumbnails swap the large photo above them.
  function showThumb(thumb) {
    var gallery = thumb.closest(".shop-gallery");
    var main = gallery && gallery.querySelector(".shop-photo");
    if (!main) return;
    var image = thumb.querySelector("img");
    main.src = thumb.getAttribute("href");
    main.alt = image ? image.alt : main.alt;
    gallery.querySelectorAll(".shop-thumb").forEach(function (other) {
      var on = other === thumb;
      other.classList.toggle("on", on);
      if (on) other.setAttribute("aria-current", "true");
      else other.removeAttribute("aria-current");
    });
  }

  document.addEventListener("click", function (event) {
    var thumb = event.target.closest && event.target.closest(".shop-thumb");
    if (thumb) {
      event.preventDefault();
      showThumb(thumb);
      return;
    }
    var image = event.target.closest && event.target.closest(".post .body img, .post-hero img, .shop-gallery .shop-photo");
    if (image) open(image);
  });
})();
