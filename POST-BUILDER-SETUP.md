# Post Builder Setup

The publisher is a Cloudflare Worker because GitHub credentials must not be exposed in the static site. It stores OAuth sessions in Cloudflare KV, checks repository permissions on every request, sanitizes post HTML, and creates one commit containing the article and updated category index. Production publishing is administrator-only.

## Create the GitHub App

1. Create a GitHub App under the `martinaudiolab` account.
2. Grant **Contents: Read and write**. GitHub grants required Metadata read access automatically.
3. Install the app on `martinaudiolab/martinaudiolab` only.
4. Set the authorization callback URL to `https://<worker-host>/auth/callback`. If the Worker has not been deployed yet, update this after its first deployment.
5. Copy the app's Client ID and generate a client secret. Do not add the secret or an App private key to this repository.

The Worker requests expiring user tokens with the `offline_access` scope. In production, it verifies that the signed-in user's GitHub repository permissions include `admin`; non-admins are denied before a publishing session is issued.

## Configure Cloudflare

There is no separate **Publishing** section for this setup. The KV namespace is created under **Workers KV**, and the Worker is deployed from a terminal with Wrangler.

### Create the KV namespace in the dashboard

1. Sign in to the [Cloudflare dashboard](https://dash.cloudflare.com/), then select the account that will host the Worker.
2. In the left navigation, open **Workers & Pages** and select **Workers KV**. You can also open the [Workers KV page](https://dash.cloudflare.com/?to=/:account/workers/kv/namespaces) directly.
3. Select **Create instance**.
4. Name the namespace `PUBLISHER_SESSIONS`, then select **Create**. This is where the Worker stores short-lived sign-in sessions; you do not need to add any key-value entries yourself.
5. Open the new namespace and copy its **Namespace ID**.
6. In `publisher/wrangler.toml`, replace `REPLACE_WITH_KV_NAMESPACE_ID` with that ID. Keep `binding = "PUBLISHER_SESSIONS"` exactly as written: the binding name is the variable the Worker uses, while the ID points to the namespace you created.

For the optional test Worker, create a second namespace named `PUBLISHER_SESSIONS_TEST` and put its ID in the `env.testing.kv_namespaces` block, replacing `REPLACE_WITH_TEST_KV_NAMESPACE_ID`. Do not reuse the production namespace for testing.

### Create the namespace with Wrangler instead

If you prefer the terminal, open PowerShell in the repository's `publisher` folder, sign in to Cloudflare, and create the namespace:

```powershell
cd path\to\martinaudiolab\publisher
npx wrangler login
npx wrangler kv namespace create PUBLISHER_SESSIONS
```

Wrangler prints the namespace ID after creation. Copy it into `wrangler.toml` as described above. For the test namespace, run `npx wrangler kv namespace create PUBLISHER_SESSIONS_TEST` and use that returned ID in the testing block.

Set these Wrangler variables in `wrangler.toml`:

- `GITHUB_CLIENT_ID`: the GitHub App Client ID.
- `SITE_ORIGIN`: the exact HTTPS origin serving the site, with no path or trailing slash.
- `BUILDER_URL`: the full HTTPS URL to `post-builder.html`.

### Deploy the Worker

Store the GitHub App client secret using Wrangler, not in a source file. Run these commands from the same `publisher` folder:

```powershell
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler deploy
```

After deployment, set the GitHub App callback URL to the Worker URL followed by `/auth/callback`. The Worker name is `martin-audio-labs-publisher`; use the `workers.dev` hostname shown by Wrangler or configure a custom Worker domain.

The dashboard does not need a separate manual KV binding: Wrangler reads the `[[kv_namespaces]]` entry in `wrangler.toml` and attaches the namespace when deploying. **Workers KV** is the storage page; `npx wrangler deploy` is the Worker publishing command.

## Test without administrator access

The `testing` Wrangler environment is limited to `http://localhost:8080` and the `post-builder-test` branch. It allows a signed-in GitHub user with repository **push** permission to exercise the complete commit path without writing to `main`. It is not an anonymous or public bypass.

1. Create the `post-builder-test` branch in GitHub.
2. Create a separate GitHub App for testing, with **Contents: Read and write**, installed only on this repository. Set its callback URL to `https://<test-worker-host>/auth/callback` after deploying the test Worker.
3. Create a second KV namespace and replace `REPLACE_WITH_TEST_KV_NAMESPACE_ID` and `REPLACE_WITH_TEST_GITHUB_APP_CLIENT_ID` in the `testing` environment.
4. From `publisher`, add the test App secret with `npx wrangler secret put GITHUB_CLIENT_SECRET --env testing`, then deploy using `npx wrangler deploy --env testing`.
5. Serve the repository root locally at `http://localhost:8080`, temporarily point the builder's `publisher-api-url` at the test Worker, and open `http://localhost:8080/site/post-builder.html`.

Test posts commit to `post-builder-test` and do not publish to the live site. Keep `ALLOW_NON_ADMIN_PUBLISHING = "false"` in the production environment; never point the testing Worker at `main` or the public website origin.

## Connect the site

In `site/post-builder.html`, replace `https://REPLACE_WITH_WORKER.workers.dev` in the `publisher-api-url` meta tag with the deployed Worker origin. Publish that site change. The Worker variables `SITE_ORIGIN` and `BUILDER_URL` must match the actual deployed website.

An administrator can then select a category, write a post, choose **Connect GitHub**, and authorize the GitHub App. **Publish post** creates a single commit with the new page in `site/stereo`, `site/radio`, or `site/test-equipment` and updates that section's `index.html`. GitHub Pages deploys the commit automatically. Branch protection that blocks direct commits will prevent publishing.

The browser receives a one-time authorization ticket and keeps only a random session handle in memory. Access and refresh tokens remain in KV; the App client secret remains a Cloudflare Worker secret. Closing the page or signing out discards the browser session handle.