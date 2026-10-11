import { HttpError } from "./errors.js";

/**
 * Checks a list of { path, data } uploads and returns the set of paths.
 * options: { pattern (allowed paths), maxBytes, maxCount, tooMany (message), sizeLabel ("4 MB") }
 */
export function validateUploads(uploads, options) {
  if (uploads.length > options.maxCount) throw new HttpError(400, options.tooMany);
  const paths = new Set();
  uploads.forEach(function (upload) {
    const path = upload && typeof upload.path === "string" ? upload.path : "";
    const data = upload && typeof upload.data === "string" ? upload.data : "";
    if (!options.pattern.test(path)) throw new HttpError(400, "Invalid image name: " + path.slice(0, 80));
    if (!/^[A-Za-z0-9+\/]+={0,2}$/.test(data) || data.length * 0.75 > options.maxBytes) {
      throw new HttpError(400, "Image " + path + " is invalid or larger than " + options.sizeLabel + ".");
    }
    if (paths.has(path)) throw new HttpError(400, "Duplicate image upload: " + path);
    paths.add(path);
  });
  return paths;
}
