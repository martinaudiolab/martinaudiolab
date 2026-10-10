(function () {
  "use strict";

  var form = document.getElementById("request-form");
  if (!form) return;
  var result = document.getElementById("request-result");
  var button = form.querySelector(".request-submit");

  function show(kind, message) {
    result.className = "request-result" + (kind ? " " + kind : "");
    result.textContent = message;
  }

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    var action = form.getAttribute("action") || "";
    if (action.indexOf("YOUR_FORM_ID") !== -1) {
      show("error", "This form is not connected yet. Please check back soon.");
      return;
    }
    button.disabled = true;
    show("", "Sending...");
    try {
      var response = await fetch(action, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      });
      if (response.ok) {
        form.reset();
        show("ok", form.getAttribute("data-success") || "Thanks \u2014 your request was sent.");
      } else {
        var data = await response.json().catch(function () { return {}; });
        var detail = Array.isArray(data.errors) ? data.errors.map(function (e) { return e.message; }).join(" ") : "";
        show("error", detail || "Sorry, that did not send. Please try again in a moment.");
      }
    } catch (error) {
      show("error", "Sorry, that did not send. Check your connection and try again.");
    } finally {
      button.disabled = false;
    }
  });
})();
