# Shop

The shop is a gallery page (`site/shop/index.html`) plus one page per item. Both are generated from one file, so you never edit the shop HTML by hand.

## Add, change or remove an item
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
