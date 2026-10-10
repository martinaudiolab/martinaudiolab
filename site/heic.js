// HEIC/HEIF support for the admin panel's image fields. Most browsers cannot open
// iPhone HEIC photos, so they are converted to JPEG here before anything else
// touches them. The converter is only downloaded the first time a HEIC photo is chosen.
(function () {
  "use strict";

  var CONVERTER = "https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js";
  var MAX_SIDE = 2400;       // converted photos are scaled down: phone photos are huge
  var loading = null;

  /** Extra values for an <input type="file"> accept list. */
  var ACCEPT = "image/heic,image/heif,.heic,.heif";

  function isHeic(file) {
    return Boolean(file) && (/^image\/hei[cf]$/i.test(file.type || "") || /\.hei[cf]$/i.test(file.name || ""));
  }

  function loadConverter() {
    if (window.heic2any) return Promise.resolve(window.heic2any);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = CONVERTER;
        script.onload = function () {
          if (window.heic2any) resolve(window.heic2any);
          else { loading = null; reject(new Error("The HEIC converter did not start.")); }
        };
        script.onerror = function () {
          loading = null;
          reject(new Error("The HEIC converter could not be downloaded. Check your connection, or export the photo as a JPEG."));
        };
        document.head.appendChild(script);
      });
    }
    return loading;
  }

  function scaleDown(blob) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var image = new Image();
      var timer = window.setTimeout(function () { resolve(blob); }, 8000);
      image.onload = function () {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        var longest = Math.max(image.naturalWidth, image.naturalHeight);
        if (!longest || longest <= MAX_SIDE) { resolve(blob); return; }
        var scale = MAX_SIDE / longest;
        var canvas = document.createElement("canvas");
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
        if (canvas.toBlob) canvas.toBlob(function (scaled) { resolve(scaled || blob); }, "image/jpeg", 0.85);
        else resolve(blob);
      };
      image.onerror = function () { window.clearTimeout(timer); URL.revokeObjectURL(url); resolve(blob); };
      image.src = url;
    });
  }

  /**
   * Resolves to the file itself unless it is HEIC/HEIF, in which case it resolves to an
   * equivalent JPEG File. Rejects with a readable message when conversion fails.
   */
  async function prepare(file) {
    if (!isHeic(file)) return file;
    var convert = await loadConverter();
    var result;
    try {
      result = await convert({ blob: file, toType: "image/jpeg", quality: 0.85 });
    } catch (error) {
      throw new Error((file.name || "That photo") + " could not be converted from HEIC. Try exporting it as a JPEG.");
    }
    var blob = Array.isArray(result) ? result[0] : result;
    blob = await scaleDown(blob);
    var name = (file.name || "photo").replace(/\.hei[cf]$/i, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  }

  window.HeicSupport = { isHeic: isHeic, prepare: prepare, accept: ACCEPT };
})();
