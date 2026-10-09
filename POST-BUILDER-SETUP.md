# Post Builder Setup

This guide connects the post builder to GitHub so an administrator can publish a post without editing or uploading HTML by hand.

When it is set up, **Publish post** will add the article and update its category page in one GitHub commit. GitHub Pages will then deploy the change. Production publishing is restricted to GitHub repository administrators.

## Before you start

You will need:

- Access to the Cloudflare account that will host the Worker.
- Permission to manage GitHub Apps for the `martinaudiolab` account.
- Node.js installed on your computer. Wrangler, the Cloudflare command-line tool, runs through `npx`.

The current `publisher/wrangler.toml` already contains a production GitHub App Client ID and KV namespace ID. Do not replace them or create another production namespace unless you have confirmed the existing namespace is missing from Cloudflare.

## 1. Find your website address

Open the repository's **Settings > Pages** page on GitHub and note the published website address. If the site uses a custom domain, use that address instead.

You will use this address in two places in `publisher/wrangler.toml`:

- `SITE_ORIGIN` is just the origin, such as `https://example.com`. Do not include a page path or a trailing slash.
- `BUILDER_URL` is the complete address of the builder page, such as `https://example.com/post-builder.html`.

Replace `YOUR_SITE_HOST` in both values. Do not guess these URLs; use the address shown in GitHub Pages or your custom-domain settings.

## 2. Check the KV namespace

KV is Cloudflare's small storage service. This Worker uses it to temporarily store sign-in sessions. You do not need to add any entries to the namespace yourself.

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/) and select the account that will host the Worker.
2. Open **Workers & Pages > Workers KV**. You can also go directly to the [Workers KV page](https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces).
3. Look for a namespace named `PUBLISHER_SESSIONS`.
4. If it exists, open it and compare its Namespace ID with the production `id` in `publisher/wrangler.toml`. If they match, this step is finished; do not create another one.
5. If it is missing, select **Create instance**, name it `PUBLISHER_SESSIONS`, and select **Create**. Open the new namespace, copy its Namespace ID, and replace only the production `id` in `publisher/wrangler.toml`.

The words in the config have separate jobs: `PUBLISHER_SESSIONS` is the name the Worker uses in code, and the long ID tells Cloudflare which namespace to connect. Wrangler reads this binding from the config during deployment, so there is no separate dashboard “Publishing” section or manual binding step.

## 3. Create the GitHub App

1. On GitHub, open the `martinaudiolab` account settings, then **Developer settings > GitHub Apps**. Select **New GitHub App**.
2. Give the app a name. After deploying the Worker, set its callback URL to the complete URL ending in `/auth/callback`. Do not use only the Worker hostname.
3. Under repository permissions, set **Contents** to **Read and write**. GitHub provides the required Metadata read access automatically.
4. Install the app on `martinaudiolab/martinaudiolab` only.
5. Copy the app's Client ID. If it is different from the Client ID already in `publisher/wrangler.toml`, replace that value.
6. Generate a client secret. Keep it private; you will enter it into Wrangler in the next step. Never put the secret in an HTML or JavaScript file.

## 4. Deploy the Worker

Open PowerShell in the repository's `publisher` folder. Replace the example folder path with the actual location of your clone:

```powershell
cd C:\path\to\martinaudiolab\publisher
npx wrangler login
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

`wrangler login` opens a Cloudflare sign-in page. The secret command prompts you to enter the GitHub App client secret; type it directly into the terminal. `wrangler deploy` uploads the Worker and connects the KV namespace from the config.

When deployment finishes, Wrangler prints the Worker URL. It will look similar to `https://martin-audio-labs-publisher.<your-account>.workers.dev`. Return to the GitHub App settings and set its callback URL to the Worker URL plus `/auth/callback`:

```text
https://martin-audio-labs-publisher.<your-account>.workers.dev/auth/callback
```

Use your actual Worker URL in place of the example.

Important: the GitHub authorization screen should say it will redirect to a URL ending in `/auth/callback`. If it shows only the Worker hostname, edit the GitHub App's callback URL before authorizing. The Worker root is not the OAuth callback route.

## 5. Connect the website

The website and publisher are two different Workers URLs:

- Website: `https://martinaudiolab-main.thealexandersound.workers.dev`
- Publisher API: `https://martin-audio-labs-publisher.thealexandersound.workers.dev`

The website URL goes in `SITE_ORIGIN` and `BUILDER_URL` in `publisher/wrangler.toml`. The publisher URL goes in the `publisher-api-url` meta tag in `site/post-builder.html`. If `npx wrangler deploy` prints a different publisher URL, use the URL Wrangler prints.

1. In `site/post-builder.html`, set `publisher-api-url` to the publisher Worker URL. Do not add a trailing slash.
2. Save and publish that site change to GitHub.
3. Check that `SITE_ORIGIN` and `BUILDER_URL` in `publisher/wrangler.toml` match the website address from Step 1. If you change either value, deploy the Worker again with `npx wrangler deploy`.
4. Open the published post builder and select **Connect GitHub**. Sign in with an administrator account and approve the GitHub App.

## Automatically deploy new posts

The publisher commits each new article and section index to `main`. The workflow at `.github/workflows/deploy-site.yml` watches for changes under `site/` and deploys the static website Worker automatically. It uses the root `wrangler.jsonc`; it does not deploy the separate publisher Worker.

Before the workflow can deploy, add two repository secrets in GitHub: open **Settings > Secrets and variables > Actions**, select **New repository secret**, and add:

- `CLOUDFLARE_API_TOKEN`: create an account API token in Cloudflare using the **Edit Cloudflare Workers** template, scoped to the `thealexandersound` account.
- `CLOUDFLARE_ACCOUNT_ID`: the account ID shown on the Cloudflare account overview page.

Once these secrets are saved and the workflow is on `main`, each post published by the builder will trigger a site deployment. Check the repository's **Actions** tab to see the deployment result. You can also run **Deploy website** manually there with **Run workflow**.

To check the publisher sign-in route, open `<publisher-Worker-URL>/auth/start` in a browser. Before login it should redirect to GitHub (HTTP 302). If it shows 404, the publisher Worker has not been deployed at that hostname; deploy it separately from the `publisher` folder.

After connecting, create a real post and select **Publish post**. It will appear in `site/stereo`, `site/radio`, or `site/test-equipment`, and its category index will link to it. Avoid test posts on production because they create real commits on `main`.

## Optional: test without publishing to the live site

The `testing` Worker environment is for a more advanced test. It is configured for the `post-builder-test` branch and `http://localhost:8080`, and still requires a signed-in GitHub user with repository write permission. It cannot publish to `main`.

Use a separate test GitHub App and KV namespace. Replace the test placeholders in the `[env.testing]` sections of `publisher/wrangler.toml`, create the `post-builder-test` branch, then run these commands from `publisher`:

```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET --env testing
npx wrangler deploy --env testing
```

Set the test GitHub App callback to the test Worker URL followed by `/auth/callback`. Serve the repository root locally at `http://localhost:8080`, temporarily set the builder's Worker URL to the test Worker, then open `http://localhost:8080/site/post-builder.html`.

Keep `ALLOW_NON_ADMIN_PUBLISHING = "false"` in production. Never point the test Worker at the public site or the `main` branch.