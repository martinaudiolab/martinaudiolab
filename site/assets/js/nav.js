(function () {
  "use strict";

  var menus = Array.prototype.slice.call(document.querySelectorAll("nav .dd"));
  if (!menus.length) return;

  function setOpen(menu, open) {
    menu.classList.toggle("open", open);
    var toggle = menu.querySelector(".dd-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", String(open));
  }

  function closeAll(except) {
    menus.forEach(function (menu) { if (menu !== except) setOpen(menu, false); });
  }

  menus.forEach(function (menu) {
    var toggle = menu.querySelector(".dd-toggle");
    toggle.addEventListener("click", function (event) {
      event.stopPropagation();
      // With a mouse the menu is already open from hover, so a click keeps it open.
      var hover = window.matchMedia("(hover: hover)").matches;
      var willOpen = hover ? true : !menu.classList.contains("open");
      closeAll(menu);
      setOpen(menu, willOpen);
    });
    menu.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && menu.classList.contains("open")) {
        setOpen(menu, false);
        toggle.focus();
      }
    });
    // Hover opens on mouse devices; clicking still toggles for keyboards and touch.
    menu.addEventListener("mouseenter", function (event) {
      if (window.matchMedia("(hover: hover)").matches) { closeAll(menu); setOpen(menu, true); }
    });
    menu.addEventListener("mouseleave", function () {
      if (window.matchMedia("(hover: hover)").matches) setOpen(menu, false);
    });
  });

  document.addEventListener("click", function () { closeAll(null); });
})();
