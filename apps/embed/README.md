# Iframe embed app

Serve a `SceneDocument` at `/embed/` using shorthand query parameters, an encoded
`#scene` fragment, or an HTTPS JSON URL. See the [embed URL reference](../../packages/minerender/reference/embeds.md)
for the public contract.

The app builds separately from the demos and has its own Cloudflare Worker
configuration. Its configured routes are `beta.minerender.org/embed` and
`beta.minerender.org/embed/*`; deployment requires the command below.
The `_headers` file allows anonymous cross-origin asset requests so the module
bundle can load in `sandbox="allow-scripts"` iframes.

## Develop locally

Use Node.js 22.12+ and Yarn 4. Run commands from the repository root.

1. Start the embed app:

   ```sh
   yarn dev:embed
   ```

2. Open `http://127.0.0.1:3001/embed/?block=minecraft:stone`.

3. To generate local iframe URLs from the editor, start it in a second terminal:

   ```sh
   EMBED_URL=http://127.0.0.1:3001/embed/ yarn dev:web
   ```

   Open `http://127.0.0.1:3000/editor/` and use **Copy embed**.

## Build and test

Build the library and app before running the test suites:

```sh
yarn build:embed
yarn test:embed
yarn test:embed:browser
```

The build writes `apps/embed/dist/`. `test:embed` covers the URL contract, shared
scene validation, payload bounds, and remote loading. The browser suite starts its
own local server and uses fixtures to exercise fragment changes, stale loads,
off-screen context release, context recovery, and storage restrictions in sandboxed
iframes. It uses the macOS Chrome executable at
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` by default. Set
`CHROME_PATH` to the Chrome executable on another system, for example:

```sh
CHROME_PATH=/usr/bin/google-chrome yarn test:embed:browser
```

The equivalent workspace command is `yarn workspace @minerender/embed test:browser`.

## Preview or deploy the Worker

`yarn preview:embed` builds the app and starts a local Wrangler preview.
`yarn deploy:embed` builds the app and publishes the routes in
[`wrangler.jsonc`](./wrangler.jsonc). Both commands run from the repository root.
To change the host used by the editor's **Copy embed**, set `EMBED_URL` when building
or starting the web workspace.
