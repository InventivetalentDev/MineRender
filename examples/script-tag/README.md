# MineRender script-tag example

This page loads the library's IIFE bundle through one script tag and uses the `MineRender` global. It renders a skin and a diamond sword with orbit controls. The bundle includes three.js and `OrbitControls`.

From the repository root:

1. Install dependencies with `yarn install`.
2. Build the library with `yarn workspace minerender build`.
3. Run `yarn workspace @minerender/example-script-tag dev`, then open `http://127.0.0.1:5174`.

Run `yarn workspace @minerender/example-script-tag build` to copy the page and library bundle into `examples/script-tag/dist`. You can serve that directory with any static web server. The page fetches Minecraft assets over HTTPS.

After editing the page or rebuilding the library, restart the development server to copy the updated files.

The example replaces the library's default vanilla source with `https://assets.mcasset.cloud/1.17.1`; the library's older default URL is retained until the asset-pipeline work.
