# MineRender Vite example

This Vue example uses ESM imports from the `minerender` workspace. It renders a skin, a diamond sword, and a stone block. Select a resource-pack ZIP to override their vanilla assets.

From the repository root:

1. Install dependencies with `yarn install`.
2. Build the library with `yarn workspace minerender build`.
3. Start the example with `yarn workspace @minerender/example-vite dev`, then open `http://127.0.0.1:5175`.

Run `yarn workspace @minerender/example-vite build` to typecheck the example and generate `examples/vite/dist`. Rebuild the library after changing its source.

The example fetches Minecraft assets over HTTPS. It keeps the Node polyfill plugin because the library's asset loaders include the NBT parser, which uses `zlib`.
