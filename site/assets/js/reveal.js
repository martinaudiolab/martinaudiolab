// Homepage: the Stereo / Radio / Test Equipment rows fade and rise into place as they
// scroll into view. Without JavaScript, an old browser, or a visitor who prefers
// reduced motion, the rows are simply visible (the hidden state is only ever added here).
(function () {
  "use strict";

  var rows = Array.prototype.slice.call(document.querySelectorAll(".cats .cat-row"));
  if (!rows.length) return;
  if (!("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var wrap = document.querySelector(".cats");
  var frame = window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : function (fn) { window.setTimeout(fn, 16); };
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in-view");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });

  // Arm the hidden state and let the browser paint it before watching the rows. Without
  // that pause a row that is already on screen at load (the first one, usually) goes straight
  // to its revealed state and never plays the transition.
  wrap.classList.add("reveal-ready");
  void wrap.offsetHeight;
  frame(function () {
    frame(function () {
      rows.forEach(function (row) { observer.observe(row); });
    });
  });
})();
