# MineRender V2

Interactive Minecraft renders for browsers and Node.js. This Yarn workspace contains the
`minerender` library, its demo pages, and examples of package and script-tag usage.
V2 is in alpha; [ROADMAP.md](./ROADMAP.md) tracks feature parity and remaining work.

## Develop locally

Use Node.js 22 or 24 with Corepack, then run these commands from the repository root:

```sh
corepack enable
yarn install --immutable
yarn build
yarn typecheck
yarn test
```

The repository pins Yarn 4.5.3. Install dependencies at the root; workspaces resolve the local
library through `workspace:*`. The library must be built before consumers can resolve its exports.

| Workspace | Purpose | Start locally |
|---|---|---|
| `packages/minerender` | Public npm package; browser, Node, and IIFE outputs | `yarn build:watch` |
| `apps/web` | Existing demo and manual test pages | `yarn dev:web` |
| `examples/vite` | Vue/Vite consumer with resource-pack ZIP input | `yarn dev:vite` |
| `examples/script-tag` | Plain HTML consuming `window.MineRender` | `yarn dev:script-tag` |

The `dev:*` commands build the library before starting their local server. The web demos use
port 3000, Vite uses port 5175, and the script-tag example uses port 5174. For library changes,
run `yarn build:watch` in another terminal and reload the consumer. Restart the script-tag server
to copy the updated bundle. Examples fetch Minecraft assets from external services.

`yarn build:lib` builds only the library. `yarn build:consumers` builds the demos and examples
against the existing library output. `yarn typecheck` checks the library and Vue example;
`yarn test` runs the existing AVA tests. `yarn doc` writes API documentation to
`packages/minerender/docs/`.

Enable renderer-owned OrbitControls at construction:

```ts
const renderer = new Renderer({ controls: { enabled: true } });
if (renderer.controls) {
    renderer.controls.enableDamping = true;
}
```

Controls use `camera.lookingAt` as their initial orbit target. While the renderer runs, it updates
damping and auto-rotation before deciding whether to redraw. Configure these behaviors through
`renderer.controls`. Controls are off by default; existing manual controls remain supported.

Use `renderer.stop()` to pause rendering and `renderer.start()` to resume. When a renderer is
no longer needed, call `renderer.dispose()` to remove its canvas, stats, and listeners and release
its rendering resources and built-in controls. Disposal is final and safe to repeat. Dispose caller-owned controls
separately; scene objects are detached without disposing their shared geometry, materials, or textures.

The optional `canvas` dependency requires a working native installation for Node imports.
Browser development can proceed if its native build fails. Actual headless rendering still
requires the renderer work described in the roadmap.

## Package and compatibility

Only `packages/minerender` is publishable. Its npm name remains `minerender`, with browser/Node
conditional exports, ESM and CommonJS entries, and the standalone `dist/bundle.js` script.
To inspect the distributable without publishing:

```sh
yarn workspace minerender pack --out /tmp/minerender.tgz
```

Maintainers can release with `yarn publish:alpha`. It builds the library, increments the alpha
version through Yarn, and publishes with the registry tag `alpha`. Version changes remain in
the working tree; create the release commit and Git tag separately.

The root website files, generated `docs/`, and legacy assets are retained for compatibility.
They are separate from the workspace builds. The V1 website and its GitHub CDN paths remain
in place while V2 is developed. Source revisions and branch findings are recorded in
[ROADMAP.md](./ROADMAP.md#monorepo-migration--2026-10-03).

See [AGENTS.md](./AGENTS.md) for architecture and contributor conventions.
