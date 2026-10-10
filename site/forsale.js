(function () {
  "use strict";

  var section = document.getElementById("forsale");
  if (!section) return;
  var track = section.querySelector(".fs-track");
  var previous = section.querySelector(".fs-prev");
  var next = section.querySelector(".fs-next");
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var paused = false;
  var timer = null;

  function card(item) {
    var link = document.createElement("a");
    link.className = "fs-card";
    link.href = "shop/" + encodeURIComponent(item.slug) + ".html";

    var thumb = document.createElement("div");
    thumb.className = "fs-thumb";
    var image = document.createElement("img");
    image.src = item.image;
    image.alt = "";
    image.loading = "lazy";
    thumb.appendChild(image);
    if (item.pending) {
      var badge = document.createElement("span");
      badge.className = "fs-badge";
      badge.textContent = "Sale pending";
      thumb.appendChild(badge);
    }

    var name = document.createElement("strong");
    name.textContent = item.title;
    var price = document.createElement("span");
    price.className = "fs-price";
    if (item.was) {
      var was = document.createElement("s");
      was.textContent = item.was;
      price.append(was, " ");
    }
    price.append(item.price);

    link.append(thumb, name, price);
    return link;
  }

  function step() {
    return Math.max(160, track.firstElementChild ? track.firstElementChild.getBoundingClientRect().width + 16 : 240);
  }

  function atEnd() {
    return track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
  }

  function advance(direction) {
    var behavior = reduceMotion ? "auto" : "smooth";
    if (direction > 0 && atEnd()) track.scrollTo({ left: 0, behavior: behavior });
    else if (direction < 0 && track.scrollLeft <= 4) track.scrollTo({ left: track.scrollWidth, behavior: behavior });
    else track.scrollBy({ left: direction * step(), behavior: behavior });
  }

  function start() {
    stop();
    if (reduceMotion || track.scrollWidth <= track.clientWidth + 4) return;
    timer = window.setInterval(function () {
      if (!paused && !document.hidden) advance(1);
    }, 4500);
  }

  function stop() {
    if (timer) window.clearInterval(timer);
    timer = null;
  }

  function show(items) {
    if (!Array.isArray(items) || !items.length) return;
    items.slice(0, 24).forEach(function (item) { track.appendChild(card(item)); });
    section.hidden = false;
    var canScroll = track.scrollWidth > track.clientWidth + 4;
    previous.hidden = next.hidden = !canScroll;
    start();
  }

  previous.addEventListener("click", function () { advance(-1); start(); });
  next.addEventListener("click", function () { advance(1); start(); });
  section.addEventListener("mouseenter", function () { paused = true; });
  section.addEventListener("mouseleave", function () { paused = false; });
  section.addEventListener("focusin", function () { paused = true; });
  section.addEventListener("focusout", function () { paused = false; });
  section.addEventListener("touchstart", function () { paused = true; }, { passive: true });
  section.addEventListener("touchend", function () { window.setTimeout(function () { paused = false; }, 6000); }, { passive: true });
  window.addEventListener("resize", function () {
    var canScroll = track.scrollWidth > track.clientWidth + 4;
    previous.hidden = next.hidden = !canScroll;
    start();
  });

  fetch("shop/feed.json", { cache: "no-cache" })
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(show)
    .catch(function () { /* the carousel simply stays hidden */ });
})();
