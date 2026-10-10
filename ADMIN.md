# Site Admin

`/admin` is a form for the text, navigation and images that appear across the site. It is the third builder page, next to the Post Builder and the Shop Builder, and uses the same GitHub sign-in and publisher Worker.

## Using it
1. Open `/admin`, select **Connect GitHub** and sign in with the administrator account.
2. Edit fields on the **Global**, **Homepage**, **Request**, **About** and **Shop** tabs.
3. Select **Save changes**. The edit is committed to GitHub and the site workflow rebuilds and deploys it, usually in under two minutes.

If the content changed somewhere else after you opened the page, saving is refused so nothing is overwritten. Reload and repeat the edit.

## Where the content lives
- `site-data/site-content.json`: the single source of truth for everything on the tabs except the shop title and introduction.
- `shop-data/items.json`: the shop. The **Shop** tab edits its `shop.title` and `shop.intro`; products are still managed in `/shop-builder`.

| Tab | Keys |
| --- | --- |
| Global | `site_name`, `contact_email`, `nav_items` (with `children` for dropdowns), `theme` |
| Homepage | `homepage.hero.{image,title,subtitle}`, `homepage.intro.text`, `homepage.categories[]`, `homepage.product_carousel.{enabled,heading,view_all_link}`, `homepage.trust_line` |
| Request | `request.{title,intro}`, `request.instructions.{heading,items}`, `request.email.{subject,body_template}`, `request.secondary_contact_text` |
| About | `about.{title,bio}`, `about.sections[]`, `about.contact.{heading,email}`, `about.location`, `about.response_time` |

Notes:
- `theme` is `auto` (match the visitor's device, the previous behavior), `dark` or `light`. It is the default; visitors can still use the Theme toggle.
- `trust_line`, `location` and `response_time` are empty until you fill them in, and are hidden while empty.
- In `secondary_contact_text`, `{email}` is replaced by the contact address as a link.
- Images chosen in the admin are resized in the browser and stored in `site/images/site/`. The previous image is removed when nothing uses it any more.

## How the site is rendered
There is no server and no database. `node scripts/build-site.mjs` turns the JSON into pages:

- generates `index.html`, `request.html`, `about.html` and everything under `shop/`;
- applies the site name, navigation and default theme to every other page (posts, section indexes, 404, the builder pages).

The deploy workflow runs that script before publishing, so the live site always matches the JSON. The admin also writes the pages it directly affects into the same commit. To preview locally, run the script from the repository root.

Because those pages are generated, edit them through `/admin` (or the JSON), not by hand: a hand edit to `index.html`, `request.html` or `about.html` is replaced on the next build.

## After pulling this change
Redeploy the publisher Worker from `publisher/` so it knows the new endpoints:

```powershell
npx wrangler deploy --config wrangler.toml
```
