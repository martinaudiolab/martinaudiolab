// Homepage hero: crossfade slideshow, and the navigation turning solid once the
// visitor scrolls past the hero. Everything degrades to a still first image.
// Also drives the request page's full-page background (#hero.page-bg).
(function () {
  "use strict";

  var hero = document.getElementById("hero");
  if (!hero) return;

  // ---- Navigation: transparent over the hero, solid below it -------------------------
  var header = document.querySelector("header.site");

  function setSolid(solid) {
    if (header) header.classList.toggle("solid", solid);
  }

  if (header && hero.classList.contains("page-bg")) {
    // A full-page background never scrolls away: the bar turns solid as soon as the page moves under it.
    var onPageScroll = function () { setSolid(window.scrollY > 8); };
    window.addEventListener("scroll", onPageScroll, { passive: true });
    onPageScroll();
  } else if (header && "IntersectionObserver" in window) {
    // Solid once the hero has scrolled up behind the navigation bar.
    var offset = Math.max(0, Math.round(header.getBoundingClientRect().height));
    new IntersectionObserver(function (entries) {
      setSolid(!entries[entries.length - 1].isIntersecting);
    }, { rootMargin: "-" + offset + "px 0px 0px 0px", threshold: 0 }).observe(hero);
  } else if (header) {
    var onScroll = function () { setSolid(hero.getBoundingClientRect().bottom <= header.offsetHeight); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  // ---- Slideshow ----------------------------------------------------------------------
  var slides = Array.prototype.slice.call(hero.querySelectorAll(".hero-slide"));

  // A banner picture that fails to arrive (a dropped connection, a cold server) is requested again a
  // few times, instead of leaving the banner empty until the next visit.
  function loaded(image) { return image.complete && image.naturalWidth > 0; }

  function retryLater(image) {
    var attempt = (Number(image.getAttribute("data-retry")) || 0) + 1;
    if (attempt > 3) return;
    image.setAttribute("data-retry", String(attempt));
    window.setTimeout(function () {
      var address = new URL(image.getAttribute("src"), window.location.href);
      address.searchParams.set("r", String(attempt));
      image.src = address.href;
    }, 700 * attempt);
  }

  slides.forEach(function (image) {
    image.addEventListener("error", function () { retryLater(image); });
    // it may already have failed before this script ran
    if (image.complete && image.naturalWidth === 0 && image.getAttribute("src")) retryLater(image);
  });

  // The later slides are requested once the page itself has loaded (their address waits in data-src), so the
  // first picture and the rest of the page get the connection to themselves.
  function requestRest() {
    slides.forEach(function (image) {
      var address = image.getAttribute("data-src");
      if (!address) return;
      image.removeAttribute("data-src");
      image.src = address;
    });
  }
  if (document.readyState === "complete") requestRest();
  else window.addEventListener("load", requestRest);

  if (slides.length < 2) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var current = 0;
  var INTERVAL = 5500;

  function show(next) {
    slides[current].classList.remove("active");
    slides[current].setAttribute("aria-hidden", "true");
    current = next;
    slides[current].classList.add("active");
    slides[current].removeAttribute("aria-hidden");
  }

  window.setInterval(function () {
    if (document.hidden) return;
    // the next picture that has actually loaded; if none has, stay on the current one
    for (var step = 1; step < slides.length; step++) {
      var candidate = (current + step) % slides.length;
      if (loaded(slides[candidate])) { show(candidate); return; }
    }
  }, INTERVAL);
})();
