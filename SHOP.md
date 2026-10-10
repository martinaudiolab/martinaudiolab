# Shop

The shop is a gallery page (`site/shop/index.html`) plus one page per item. Both are generated from one file, so you never edit the shop HTML by hand.

## Using the Shop Builder (recommended)
Open `/shop-builder` on the website, select **Connect GitHub** and sign in with the administrator account (the same sign-in the Post Builder uses).

- **Add item** opens a form: title, one-line summary, category, status, price, optional previous price (shows a sale), description (blank line between paragraphs), optional detail rows and photos.
- Photos are resized to 1600 px JPEGs in your browser before upload. The first photo is the gallery picture.
- **Edit**, **Remove**, **Up** and **Down** manage existing listings. **Shop page text** edits the title, introduction, how-to-buy note and inquiry email.
- Nothing goes live until you select **Publish changes**. That commits `shop-data/items.json`, the new photos and the regenerated `site/shop/` pages in one GitHub commit, and the site workflow deploys it.
- Removing an item also deletes its page and any photos in `site/images/shop/` that no other item uses.
- If the shop changed somewhere else (for example someone ran the script) after you opened the page, publishing is refused so nothing is overwritten. Reload and repeat your edit.

The builder reuses the publisher Worker in `publisher/`, so after pulling this change run `npx wrangler deploy` from that folder once. No new secrets, GitHub App settings or KV namespaces are needed.

## Editing by hand instead
Everything below still works and produces identical pages. Both paths share `scripts/shop-render.mjs`.

### Add, change or remove an item
1. Add photos to `site/images/shop/` (JPEG, about 1600 px wide is plenty).
2. Edit `shop-data/items.json`. Copy an existing item and change it. Fields:
   - `slug`: the page name, lowercase letters, numbers and hyphens (for example `marantz-2270`). Must be unique.
   - `title`, `summary` (one line shown in the gallery), `category`
   - `price`: a number such as `650`. Add `"was": 750` to show a sale price. Use text such as `"Inquire"` instead of a number if you prefer.
   - `status`: `available`, `pending` or `sold`. Sold items move to the end and are greyed out.
   - `images`: a list; the first is the gallery photo. Example: `["images/shop/marantz-front.jpg", "images/shop/marantz-back.jpg"]`
   - `description`: a list of paragraphs. `details`: optional list of `["Label", "Value"]` pairs.
   - `sample`: delete this line (and the sample items) for real listings.
3. Run `node scripts/build-shop.mjs` from the repository root. It reports mistakes and rebuilds `site/shop/`.
4. Commit and push. The existing deploy workflow publishes anything under `site/`.

## How buying works
There is no cart or payment system. Each item page has an **Inquire** button that opens an email to the address in `shop.email`, with the item already named. Payment and shipping are arranged by email.
