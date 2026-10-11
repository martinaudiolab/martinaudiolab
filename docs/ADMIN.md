# Site Admin

`/admin` is the one place to manage the site. It has nine tabs: **Global**, **Homepage**, **Request**, **About**, **Shop** and **Blog** edit the site content, and **Shop Builder**, **Post Builder** and **Manage Blog Posts** hold the shop listing manager, the blog post editor and the published-post manager. One GitHub sign-in covers all of them, through the publisher Worker.

## Using it
1. Open `/admin`, select **Connect GitHub** and sign in with the administrator account.
2. Edit fields on the **Global**, **Homepage**, **Request**, **About** and **Shop** tabs.
3. Select **Save changes**. The edit is committed to GitHub and the site workflow rebuilds and deploys it, usually in under two minutes.

If the content changed somewhere else after you opened the page, saving is refused so nothing is overwritten. Reload and repeat the edit.

## Shop Builder and Post Builder tabs
The shop listing manager and the blog post editor. Each has its own Publish button; the Save changes bar applies to the five content tabs only. See `SHOP.md` for how shop listings work.

Every post listed on a section page (Stereo Repair, Radio Repair, Test Equipment) has a thumbnail. In the Post Builder you can choose one; otherwise the first photo in the post is used, and a post with no photo shows the section picture. Thumbnails are small JPEGs stored in `site/images/posts/` and are removed when the post is deleted.

**Banner loading:** every banner picture is requested as the page loads (the first with a preload hint in the page head and at high priority, the others at low priority), none is lazy-loaded, and the slideshow only fades to a picture that has actually arrived. A picture that fails to load is requested again up to three times with a short delay, so a dropped connection or a cold server does not leave a banner empty.

**Listing cards:** posts on the section pages and the Restoration Blog page are cards: title, the post summary as an uppercase subtitle, the date, the picture with a short excerpt taken from the post text and a Read more link, and a footer tag naming the section. The build brings every existing listing to this layout and refreshes the excerpts; new posts are written as cards by the Worker.

**Blog banners:** the **Blog** tab has a banner slideshow (up to four images) for the Restoration Blog page and one for each section, edited independently. Each blog page shows the same floating toolbar as Home and Shop over its own banner (the same size as the homepage and shop banners) with the page title on it (the section name, or Restoration Blog); the heading and intro paragraph that used to sit below the banner are gone, and individual posts use the continuous toolbar bar. A page with no image of its own shows its section picture (or the site banner for the Restoration Blog page).

**Galleries:** in the Post Builder, the **Gallery** button places 2 to 4 photos side by side as a grid (choose *2 per row* or *4 in a row* first). A lone last photo in a 2-per-row grid spans the full width, and 4-in-a-row becomes 2 per row on phones. Visitors click any photo to enlarge it, then step through the set with the arrows or the left/right keys. Gallery photos are kept to about 1600 px so a post with several galleries stays under the 5 MB limit.

Every image field in the admin accepts HEIC/HEIF photos (for example straight from an iPhone). They are converted to JPEG in the browser before upload, using the `heic2any` library from the jsDelivr CDN, which is downloaded only the first time a HEIC photo is chosen.

## Where the content lives
- `site-data/site-content.json`: the single source of truth for everything on the tabs except the shop title and introduction.
- `shop-data/items.json`: the shop. The **Shop** tab edits its `shop.title` and `shop.intro`; products are still managed in the **Shop Builder** tab.

| Tab | Keys |
| --- | --- |
| Global | `site_name`, `contact_email`, `nav_items` (with `children` for dropdowns) |
| Homepage | `homepage.hero.{slides[],title,subtitle}` (up to 4 slides, each `{image, alt}`), `homepage.categories[]`, `homepage.product_carousel.{enabled,heading,view_all_link}`, `homepage.trust_line` |
| Shop page | `shop_hero.slides[]` (its own set of up to 4 slides, separate from the homepage), plus the shop title and intro from `shop-data/items.json` |
| Request | `request.{title,intro,form_action,subject,success_message}` |
| About | `about.{title,bio}`, `about.sections[]`, `about.contact.{heading,email}`, `about.location`, `about.response_time` |

Notes:
- `trust_line`, `location` and `response_time` are empty until you fill them in, and are hidden while empty.
- In `secondary_contact_text`, `{email}` is replaced by the contact address as a link.
- Images chosen in the admin are resized in the browser and stored in `site/images/site/`. The previous image is removed when nothing uses it any more.

## How the site is rendered
There is no server and no database. `node build/build-site.mjs` turns the JSON into pages:

- generates `index.html`, `request.html`, `about.html` and everything under `shop/`;
- applies the site name and navigation to every other page (posts, section indexes, 404, the builder pages).

The deploy workflow runs that script before publishing, so the live site always matches the JSON. The admin also writes the pages it directly affects into the same commit. To preview locally, run the script from the repository root.

Because those pages are generated, edit them through `/admin` (or the JSON), not by hand: a hand edit to `index.html`, `request.html` or `about.html` is replaced on the next build.

## After pulling this change
Redeploy the publisher Worker from `publisher/` so it knows the new endpoints:

```powershell
npx wrangler deploy --config wrangler.toml
```

## Setup and deployment

One-time setup that connects the admin panel to GitHub. Most of it is already done for this site; keep it here for rebuilding or moving the site.

### How the pieces fit
- **Website Worker** (`martinaudiolab-main`, root `wrangler.jsonc`): serves everything in `site/`. GitHub Actions deploys it on every push.
- **Publisher Worker** (`martin-audio-labs-publisher`, `publisher/wrangler.toml`): the API behind `/admin`. It signs you in through a GitHub App and commits changes to `main`. It is deployed by hand and is **not** part of the Actions workflow.
- **KV namespace `PUBLISHER_SESSIONS`**: short-lived sign-in sessions. No entries need to be added by hand.
- **GitHub App**: lets the publisher sign administrators in and write to the repository.

### 1. Website address
`SITE_ORIGIN` in `publisher/wrangler.toml` (both the default block and `[env.testing]`) must be the exact address the site is served from: an origin only, with no path and no trailing slash, for example `https://example.com`. The Worker rejects admin requests from any other origin. If the site moves to a new domain, change this value and redeploy the publisher.

### 2. KV namespace
1. In the Cloudflare dashboard open **Workers & Pages > Workers KV** and look for `PUBLISHER_SESSIONS`.
2. If it exists, check its Namespace ID matches the production `id` in `publisher/wrangler.toml`. If so, do not create another.
3. If it is missing, create it, copy its Namespace ID and replace only the production `id`.

### 3. GitHub App
1. In the `martinaudiolab` account settings open **Developer settings > GitHub Apps** and choose **New GitHub App**.
2. Set repository permission **Contents** to **Read and write**. Install it on `martinaudiolab/martinaudiolab` only.
3. Copy the Client ID into `GITHUB_CLIENT_ID` in `publisher/wrangler.toml` if it differs.
4. Generate a client secret and keep it private. It is entered into Wrangler below and never goes in a file.
5. Set the callback URL (after the Worker is deployed) to the publisher URL plus `/auth/callback`, for example `https://martin-audio-labs-publisher.<account>.workers.dev/auth/callback`. The Worker root is not the callback.

### 4. Deploy the publisher
From the `publisher` folder:

```powershell
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy --config wrangler.toml
```

Always pass `--config wrangler.toml`. Without it Wrangler can pick up the root `wrangler.jsonc` and redeploy the website Worker instead. Redeploy the publisher whenever `publisher/worker.js`, the shared `scripts/*.mjs` modules it imports, or `publisher/wrangler.toml` change.

To check it, open `<publisher URL>/auth/start`. It should redirect to GitHub (HTTP 302). A 404 means it is not deployed at that address.

### 5. Connect the admin page
`site/admin/index.html` has a `publisher-api-url` meta tag. It must be the publisher URL Wrangler printed, with no trailing slash.

### 6. Automatic site deploys
The workflow `.github/workflows/deploy-site.yml` runs on pushes that touch `site/`, `site-data/`, `shop-data/`, `build/` or `shared/`. It runs `node scripts/build-site.mjs` and then deploys the website Worker. Add two repository secrets under **Settings > Secrets and variables > Actions**:

- `CLOUDFLARE_API_TOKEN`: an account API token from the **Edit Cloudflare Workers** template. Leave **Client IP Address Filtering** empty; GitHub's runners use changing addresses and a filter causes Cloudflare error 9109.
- `CLOUDFLARE_ACCOUNT_ID`: shown on the Cloudflare account overview page.

Check results on the repository's **Actions** tab. **Run workflow** deploys manually.

### Optional: test without touching the live site
The `testing` environment publishes to a `post-builder-test` branch instead of `main` and allows non-admin writers. Give it its own test GitHub App and KV namespace, fill in the `[env.testing]` placeholders, create the branch, then:

```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET --env testing
npx wrangler deploy --config wrangler.toml --env testing
```

Never point the test Worker at `main`, and keep `ALLOW_NON_ADMIN_PUBLISHING = "false"` in production.

## Development notes

- **Build:** `node build/build-site.mjs` regenerates the pages from `site-data/` and `shop-data/`, applies the site name and navigation to every page, and writes `site/robots.txt`. Set the `SITE_URL` environment variable (for example `https://martinaudiolabs.com`) to also write `site/sitemap.xml`. In GitHub Actions, add a repository variable called `SITE_URL`; the deploy workflow passes it to the build.
- **Tests:** `cd tests && npm install && npm test` runs the browser-side and Worker test suites (one file per area, `*.test.mjs`; pinned data in `tests/fixtures`). The *Tests* workflow runs them on every push and pull request, separately from the deploy so that saving content in `/admin` is never blocked.
- **Caching:** `site/_headers` keeps caching deliberately light. Pictures, pages and data are re-checked with the server every time (the browser keeps a copy and the server just answers "unchanged"), so nothing can be stuck in a visitor's cache; only the stylesheet and scripts (`assets/`, which keep their names when they change) are cached for ten minutes. Long-lived "immutable" picture caching was removed after banner pictures occasionally failed to appear. A test guards that nothing is made immutable or long-lived.
- **404 page:** `wrangler.jsonc` serves `site/404.html` for any missing address; the page uses `<base href="/">` so its styles and links work from any depth.
- **Blog sections:** the list of sections lives in `shared/sections.mjs` (key, folder, name, homepage description, picture). The navigation defaults, homepage rows, publisher Worker, build, sitemap and the admin dropdowns all read it. To add a section: add it there, copy an existing `site/<folder>/index.html` for the new folder, then rebuild and redeploy the Worker.
- **Restoration Blog page:** `site/blog/index.html` is generated by the build from the section pages (newest first across all sections). Post pages get a breadcrumb and older/newer links at build time, so they stay correct as posts are published or deleted.

## Where things are

| Path | What it is |
| --- | --- |
| `site/` | The deployed website (Cloudflare serves this folder). |
| `site/assets/css/style.css`, `site/assets/js/` | The stylesheet and the scripts visitors load. |
| `site/admin/` | The admin panel (`index.html` plus its scripts), served at `/admin/`. |
| `site/images/` | Pictures: defaults at the root, `site/` (admin uploads), `shop/`, `posts/`. Paths are saved in the data files and in published pages, so the folder names are part of the content. |
| `site/stereo/`, `radio/`, `test-equipment/`, `blog/`, `shop/` | Section pages and posts (published from the admin), the generated blog landing page, and the generated shop. |
| `site-data/`, `shop-data/` | The editable content (JSON). |
| `build/` | The build scripts (`build-site.mjs`, `build-shop.mjs`). |
| `shared/` | Pure modules used by both the build and the Worker (`sections.mjs` is the sections list, `site-urls.mjs` the address helpers). |
| `publisher/worker.js`, `publisher/src/` | The publisher Worker: `worker.js` routes requests; `src/` has `auth`, `content`, `shop`, `posts`, `github`, `repo`, `http`, `sanitize` and `uploads`. |
| `tests/` | Test suites. |

Addresses on the site are root-absolute (`/assets/css/style.css`, `/shop/`, `/stereo/some-post`), so a page can be generated at any depth without working out `../`. The helpers are in `shared/site-urls.mjs`; `tests/site-links.test.mjs` checks that every link and file reference on the built site resolves.
