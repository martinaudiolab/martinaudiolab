// HEIC/HEIF support for the admin panel's image fields. Most browsers cannot open
// iPhone HEIC photos, so they are converted to JPEG here before anything else
// touches them. The converter is only downloaded the first time a HEIC photo is chosen.
//
// There is deliberately no size or resolution limit here: the photo is converted at
// full resolution. (Each image field then resizes it for the web, as it does for JPEGs.)
(function () {
  "use strict";

  // heic-to bundles a recent libheif and decodes inside a web worker, so large and
  // newer iPhone photos work. It is a single self-contained file.
  var CONVERTER = "https://cdn.jsdelivr.net/npm/heic-to@1.6.5/dist/iife/heic-to.js";
  var loading = null;

  /** Extra values for an <input type="file"> accept list. */
  var ACCEPT = "image/heic,image/heif,.heic,.heif";

  // File-type brands that mean "HEIF family" when found in the file's first bytes.
  var BRANDS = ["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"];

  /** True when the name or type says HEIC/HEIF (synchronous, no file reading). */
  function isHeic(file) {
    return Boolean(file) && (/^image\/hei[cf]$/i.test(file.type || "") || /\.hei[cf]$/i.test(file.name || ""));
  }

  function readHead(file) {
    return new Promise(function (resolve) {
      try {
        var reader = new FileReader();
        reader.onload = function () { resolve(new Uint8Array(reader.result)); };
        reader.onerror = function () { resolve(null); };
        reader.readAsArrayBuffer(file.slice(0, 64));
      } catch (error) { resolve(null); }
    });
  }

  /**
   * Also recognises HEIC photos that carry the wrong name or type (a HEIC saved as
   * ".jpg" by a sync tool, for example) by looking for the "ftyp" box and a HEIF brand.
   */
  async function detect(file) {
    if (!file) return false;
    if (isHeic(file)) return true;
    if (!file.slice || (file.size || 0) < 16) return false;
    var head = await readHead(file);
    if (!head || head.length < 16) return false;
    var text = String.fromCharCode.apply(null, Array.prototype.slice.call(head, 4, 64));
    if (text.slice(0, 4) !== "ftyp") return false;
    return BRANDS.some(function (brand) { return text.indexOf(brand) >= 0; });
  }

  function loadConverter() {
    if (window.HeicTo) return Promise.resolve(window.HeicTo);
    if (!loading) {
      loading = new Promise(function (resolve, reject) {
        var script = document.createElement("script");
        script.src = CONVERTER;
        script.onload = function () {
          if (window.HeicTo) resolve(window.HeicTo);
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

  function drawToJpeg(source, width, height, maxSide) {
    return new Promise(function (resolve, reject) {
      var scale = maxSide && Math.max(width, height) > maxSide ? maxSide / Math.max(width, height) : 1;
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      var context = canvas.getContext("2d");
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(function (blob) {
        if (blob) resolve(blob); else reject(new Error("The image could not be encoded."));
      }, "image/jpeg", 0.9);
    });
  }

  /** The browser's own decoder (Safari, and Edge with the HEIF extension). Resolves null if it cannot. */
  function nativeDecode(file, maxSide) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      var timer = window.setTimeout(function () { URL.revokeObjectURL(url); resolve(null); }, 15000);
      image.onload = function () {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        if (!image.naturalWidth || !image.naturalHeight) { resolve(null); return; }
        drawToJpeg(image, image.naturalWidth, image.naturalHeight, maxSide).then(resolve, function () { resolve(null); });
      };
      image.onerror = function () { window.clearTimeout(timer); URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    });
  }

  function describe(error) {
    if (!error) return "";
    if (typeof error === "string") return error;
    return error.message || error.code || "";
  }

  /**
   * Resolves to the file itself unless it is HEIC/HEIF, in which case it resolves to an
   * equivalent JPEG File at full resolution. Pass { maxSide } to scale the result down.
   * Rejects with a readable message when conversion fails.
   */
  async function prepare(file, options) {
    if (!(await detect(file))) return file;
    var maxSide = options && options.maxSide ? options.maxSide : 0;
    var name = (file.name || "photo").replace(/\.[A-Za-z0-9]+$/, "") + ".jpg";

    var blob = await nativeDecode(file, maxSide);
    if (!blob) {
      var convert = await loadConverter();
      try {
        // heic-to reads the file's bytes itself, so a wrong name or type does not matter.
        blob = await convert({ blob: file, type: "image/jpeg", quality: 0.9 });
      } catch (error) {
        var reason = describe(error);
        throw new Error((file.name || "That photo") + " could not be converted from HEIC" + (reason ? " (" + reason + ")" : "") + ". Try exporting it as a JPEG.");
      }
      if (maxSide) {
        var scaled = await shrink(blob, maxSide);
        if (scaled) blob = scaled;
      }
    }
    return new File([blob], name, { type: "image/jpeg" });
  }

  /** Scales a JPEG blob down to maxSide; resolves null if it is already small or cannot be read. */
  function shrink(blob, maxSide) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(blob);
      var image = new Image();
      var timer = window.setTimeout(function () { URL.revokeObjectURL(url); resolve(null); }, 15000);
      image.onload = function () {
        window.clearTimeout(timer);
        URL.revokeObjectURL(url);
        if (Math.max(image.naturalWidth, image.naturalHeight) <= maxSide) { resolve(null); return; }
        drawToJpeg(image, image.naturalWidth, image.naturalHeight, maxSide).then(resolve, function () { resolve(null); });
      };
      image.onerror = function () { window.clearTimeout(timer); URL.revokeObjectURL(url); resolve(null); };
      image.src = url;
    });
  }

  window.HeicSupport = { isHeic: isHeic, detect: detect, prepare: prepare, accept: ACCEPT };
})();
