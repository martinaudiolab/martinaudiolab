// Where things are, independent of where the repository is checked out.
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
/** The repository root, with a trailing slash (forward slashes on every platform). */
export const ROOT = path.resolve(here, "..").split(path.sep).join("/") + "/";
/** The same, as a file:// URL for dynamic import(). */
export const ROOT_URL = pathToFileURL(path.resolve(here, "..") + path.sep).href;
/** Pinned test data (a normalised copy of the site content and shop). */
export const FIXTURES = process.env.FIXTURES || path.join(here, "fixtures");
