// Homepage "For Sale Now": a centered grid of available products that quietly
// fades to the next set every 30 seconds. Reads shop/feed.json, which the shop
// build writes (sold items are not in it).
(function () {
  "use strict";

  var section = document.getElementById("forsale");
  if (!section) return;
  var grid = section.querySelector(".fs-grid");

  var ROTATE_MS = 30000;      // time between sets
  var FADE_MS = 300;          // fade out, then fade in: about 600ms in total
  var DESKTOP_COUNT = 4;      // products shown at once (tablet shows the same four as 2 x 2)
  var PHONE_COUNT = 1;        // phones show one product at a time and rotate through the rest

  var phone = window.matchMedia ? window.matchMedia("(max-width: 599px)") : { matches: false };
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var items = [];
  var offset = 0;             // index of the first product in the current set
  var hovering = false;
  var busy = false;
  var timer = null;

  function setSize() {
    return phone.matches ? PHONE_COUNT : DESKTOP_COUNT;
  }

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

    var name = document.createElement("div");
    name.className = "fs-name";
    name.textContent = item.title;

    var price = document.createElement("div");
    price.className = "fs-price";
    if (item.was) {
      var was = document.createElement("s");
      was.textContent = item.was;
      var sale = document.createElement("span");
      sale.className = "fs-sale";
      sale.textContent = item.price;
      price.append(was, sale);
    } else {
      price.textContent = item.price;
    }

    link.append(thumb, name, price);
    return link;
  }

  /** The current set, wrapping around the catalogue so it is always full when it can be. */
  function currentSet() {
    var size = Math.min(setSize(), items.length);
    var set = [];
    for (var i = 0; i < size; i++) set.push(items[(offset + i) % items.length]);
    return set;
  }

  function render() {
    grid.replaceChildren.apply(grid, currentSet().map(card));
  }

  function rotates() {
    return !reduceMotion && items.length > setSize();
  }

  function rotate() {
    if (hovering || busy || document.hidden || !rotates()) return;
    busy = true;
    grid.classList.add("fs-fade");
    window.setTimeout(function () {
      offset = (offset + setSize()) % items.length;
      render();
      grid.classList.remove("fs-fade");
      busy = false;
    }, FADE_MS);
  }

  function schedule() {
    if (timer) window.clearInterval(timer);
    timer = rotates() ? window.setInterval(rotate, ROTATE_MS) : null;
  }

  function start(feed) {
    if (!Array.isArray(feed) || !feed.length) return;
    items = feed;
    render();
    section.hidden = false;
    schedule();
  }

  // Hold still while someone is reading or has focus inside the grid.
  grid.addEventListener("mouseenter", function () { hovering = true; });
  grid.addEventListener("mouseleave", function () { hovering = false; });
  grid.addEventListener("focusin", function () { hovering = true; });
  grid.addEventListener("focusout", function () { hovering = false; });

  if (phone.addEventListener) {
    phone.addEventListener("change", function () {
      if (!items.length) return;
      offset = 0;
      render();
      schedule();
    });
  }

  fetch("shop/feed.json", { cache: "no-cache" })
    .then(function (response) { return response.ok ? response.json() : []; })
    .then(start)
    .catch(function () { /* the section simply stays hidden */ });
})();
