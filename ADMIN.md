# Site Admin

`/admin` is the one place to manage the site. It has eight tabs: **Global**, **Homepage**, **Request**, **About** and **Shop** edit the site content, and **Shop Builder**, **Post Builder** and **Manage Blog Posts** hold the shop listing manager, the blog post editor and the published-post manager. One GitHub sign-in covers all of them, through the publisher Worker.

## Using it
1. Open `/admin`, select **Connect GitHub** and sign in with the administrator account.
2. Edit fields on the **Global**, **Homepage**, **Request**, **About** and **Shop** tabs.
3. Select **Save changes**. The edit is committed to GitHub and the site workflow rebuilds and deploys it, usually in under two minutes.

If the content changed somewhere else after you opened the page, saving is refused so nothing is overwritten. Reload and repeat the edit.

## Shop Builder and Post Builder tabs
The shop listing manager and the blog post editor. Each has its own Publish button; the Save changes bar applies to the five content tabs only. See `SHOP.md` for how shop listings work.

Every post listed on a section page (Stereo Repair, Radio Repair, Test Equipment) has a thumbnail. In the Post Builder you can choose one; otherwise the first photo in the post is used, and a post with no photo shows the section picture. Thumbnails are small JPEGs stored in `site/images/posts/` and are removed when the post is deleted.

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
There is no server and no database. `node scripts/build-site.mjs` turns the JSON into pages:

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
`site/admin.html` has a `publisher-api-url` meta tag. It must be the publisher URL Wrangler printed, with no trailing slash.

### 6. Automatic site deploys
The workflow `.github/workflows/deploy-site.yml` runs on pushes that touch `site/`, `site-data/`, `shop-data/` or `scripts/`. It runs `node scripts/build-site.mjs` and then deploys the website Worker. Add two repository secrets under **Settings > Secrets and variables > Actions**:

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
