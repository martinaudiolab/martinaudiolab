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
  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("in-view");
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15, rootMargin: "0px 0px -6% 0px" });

  // Arm the hidden state only now that the observer exists to reveal the rows again.
  wrap.classList.add("reveal-ready");
  rows.forEach(function (row) { observer.observe(row); });
})();
