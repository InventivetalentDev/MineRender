# MineRender V2

A TypeScript library for rendering Minecraft skins, models, blocks, entities, and worlds.
This monorepo contains the `minerender` package, demo pages, and examples.
V2 is in beta; see [ROADMAP.md](./ROADMAP.md) for progress and remaining work,
including headless Node rendering.

## Develop locally

Use Node.js 22.12+ and Yarn 4.5.3 through Corepack. Run these commands from the repository root:

```sh
corepack enable
yarn install --immutable
yarn build
```

Choose a workspace to work on:

| Workspace | Purpose | Development command |
|---|---|---|
| [packages/minerender](./packages/minerender) | Public library | `yarn build:watch` |
| [apps/web](./apps/web) | Demo and manual test pages | `yarn dev:web` |
| [apps/site](./apps/site) | V2 website with live examples and docs | `yarn dev:site` |
| [examples/vite](./examples/vite) | Vue/Vite example | `yarn dev:vite` |
| [examples/script-tag](./examples/script-tag) | Plain HTML example | `yarn dev:script-tag` |

The `dev:*` commands build the library before starting their server.
Run `yarn typecheck` and `yarn test` to check your changes.

## Generate API documentation

Run `yarn doc` from the repository root to generate the API and build the VitePress
site in `packages/minerender/docs/`. Run `yarn doc:preview` to serve that build,
or `yarn doc:dev` to generate the API and start a development server.

Author reference pages in `packages/minerender/reference/`. TypeDoc generates
`reference/api/`; do not edit those files. The sidebar groups exported APIs by
feature and keeps shared declarations in one place. Protected members and inherited
three.js members are omitted; inherited MineRender methods remain documented.
The grouping rules live in `packages/minerender/scripts/typedoc-navigation.mjs`.

After changing library code, rerun `yarn workspace minerender doc:generate` to
refresh the API during development. Generated pages, caches, and build output are
ignored by Git. For hosting under a subdirectory, set `DOCS_BASE` when building,
for example `DOCS_BASE=/v2/docs/ yarn doc`.

See [AGENTS.md](./AGENTS.md) for architecture, contributor conventions, and publishing instructions.
