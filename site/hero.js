// Homepage hero: crossfade slideshow, and the navigation turning solid once the
// visitor scrolls past the hero. Everything degrades to a still first image.
(function () {
  "use strict";

  var hero = document.getElementById("hero");
  if (!hero) return;

  // ---- Navigation: transparent over the hero, solid below it -------------------------
  var header = document.querySelector("header.site");

  function setSolid(solid) {
    if (header) header.classList.toggle("solid", solid);
  }

  if (header && "IntersectionObserver" in window) {
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
    show((current + 1) % slides.length);
  }, INTERVAL);
})();
