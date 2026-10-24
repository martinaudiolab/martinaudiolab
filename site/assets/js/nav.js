// Phones: the navigation folds behind a menu button in the header. The stylesheet hides the bar only once this
// button exists (header.has-menu), so without JavaScript the bar simply stays visible.
(function () {
  "use strict";

  var header = document.querySelector("header.site");
  var nav = header && header.querySelector("nav");
  if (!nav) return;
  nav.id = nav.id || "site-nav";

  var button = document.createElement("button");
  button.type = "button";
  button.className = "menu-toggle";
  button.setAttribute("aria-controls", nav.id);
  button.innerHTML = '<span class="menu-icon" aria-hidden="true"></span>';
  var brand = header.querySelector(".brand");
  header.insertBefore(button, brand ? brand.nextSibling : header.firstChild);
  header.classList.add("has-menu");

  function isOpen() { return header.classList.contains("menu-open"); }
  function setOpen(open) {
    header.classList.toggle("menu-open", open);
    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Menu");
  }
  setOpen(false);

  button.addEventListener("click", function (event) {
    event.stopPropagation();
    setOpen(!isOpen());
  });
  // choosing a page, pressing Escape or tapping outside the header closes it
  nav.addEventListener("click", function (event) {
    if (event.target.closest && event.target.closest("a")) setOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && isOpen()) { setOpen(false); button.focus(); }
  });
  document.addEventListener("click", function (event) {
    if (isOpen() && !header.contains(event.target)) setOpen(false);
  });
  // a phone turned sideways (or a window widened) past the breakpoint shows the full bar again
  if (window.matchMedia) {
    var wide = window.matchMedia("(min-width: 701px)");
    var onChange = function () { if (wide.matches) setOpen(false); };
    if (wide.addEventListener) wide.addEventListener("change", onChange);
    else if (wide.addListener) wide.addListener(onChange);
  }
})();

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
