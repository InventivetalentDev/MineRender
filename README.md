# MineRender V2

A TypeScript library for rendering Minecraft skins, models, blocks, entities, and worlds.
This monorepo contains the `minerender` package, demo pages, and examples.
V2 is in beta; see [ROADMAP.md](./ROADMAP.md) for progress and remaining work,
including headless Node rendering.

## Develop locally

Use Node.js 22+ and Yarn 4.5.3 through Corepack. Run these commands from the repository root:

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
| [examples/vite](./examples/vite) | Vue/Vite example | `yarn dev:vite` |
| [examples/script-tag](./examples/script-tag) | Plain HTML example | `yarn dev:script-tag` |

The `dev:*` commands build the library before starting their server.
Run `yarn typecheck` and `yarn test` to check your changes.

See [AGENTS.md](./AGENTS.md) for architecture, contributor conventions, and publishing instructions.
