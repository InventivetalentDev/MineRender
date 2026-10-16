# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Web developers who add Minecraft renders to community sites, wikis, server websites, and tools: skin viewers, block and item previews, entity showcases, inventory screens, and world views. They read the website and API reference, copy example code, and ship it in their own pages.

Other audiences that existing surfaces serve (Node and HTTP API users, creators previewing assets in the editor, V1 integrators) are not ranked yet.

## Product Purpose

MineRender is a TypeScript library that turns Minecraft skins, blocks, items, entities, GUIs, structures, and worlds into interactive three.js scenes. V2 is a from-scratch rewrite of V1 (minerender.org) with cleaner code, better performance, Node support, and full-world rendering. Success means a developer gets an accurate render of the content they need into their page with a few lines of code, and V1 users have a clear path to V2.

## Positioning

- **Breadth in one scene.** Skins, blocks, items, entities, GUIs, structures, and worlds share one renderer and one scene, instead of one wrapper per content type.
- **Vanilla fidelity.** Geometry, registry data, tints, and item state come from versioned datasets extracted from each game version, and behavior is checked against the game's own code.
- **Runs anywhere.** One codebase serves ESM and CommonJS imports, a script-tag bundle, Node PNG rendering, an iframe embed, and a self-hosted HTTP API.
- **Your assets.** Resource-pack ZIPs, custom asset roots, and any game version layer over the vanilla assets.

## Operating Context

- Public surfaces: the website at beta.minerender.org (`apps/site`: feature list, live examples with their code, usage docs, V1 migration guide), the API reference at beta-docs.minerender.org, the scene editor and playgrounds (`apps/web`), and the iframe embed at `/embed/` (`apps/embed`).
- Developers install `minerender@beta` with three.js as a peer dependency, or load `dist/bundle.js` from unpkg.
- Assets load on demand from assets.mcasset.cloud by default (Minecraft 1.21.11), so renders need network access unless the caller supplies its own sources.
- Browsers limit live WebGL contexts; pages with many renders keep only a few renderers alive and show snapshots for the rest.

## Capabilities and Constraints

- V2 is in beta and published under the `beta` npm tag. The public API used by the example consumers is semi-frozen.
- Browser rendering requires WebGL 2, Fetch, and `AbortSignal.any()`/`timeout()`. Node requires 22.12+ and the optional native `canvas` and `gl` packages.
- Features that the library does not support yet (listed in `AGENTS.md` and `ROADMAP.md`, for example light propagation, LOD, and some special item renderers) must not be presented as supported.
- No public hosted render endpoint exists. The HTTP API runs from the repository.
- V1, its tags, its bundles, and minerender.org stay online and unchanged.
- Terminology: write "MineRender" and "V2"; use the game's own names for content (blockstate, resource pack, item component, chunk section).

## Brand Commitments

- Name: MineRender, version label "v2 beta".
- Logo: `apps/site/public/logo.svg`, designed by Andre601 and credited in the README.
- Voice: plain copy that describes what the library does, not how great it is (`apps/site/README.md`).
- MIT licensed, made by inventivetalent. The website carries the notice "Not an official Minecraft product. Not approved by or associated with Mojang or Microsoft."

## Evidence on Hand

- Live examples for every content type, each paired with the code that produced it (`apps/site/src/examples/`).
- The scene editor, per-type playgrounds, and the world demo that streams local Java saves (`apps/web/`).
- The embed page and its URL contract (`apps/embed/`, `packages/minerender/reference/embeds.md`).
- An announcement-video render pipeline (`apps/site/src/video/`) and the site's `og-image.png`.
- Internal world-streaming benchmarks (`apps/web/benchmarks/`); their numbers are development measurements, not published claims.
- No testimonials, adopter list, download figures, or published performance numbers exist. Do not invent them.

## Product Principles

1. **Show the render, then the code.** Every claim on a public surface is backed by a live render, and the code shown beside it is the code that produced it.
2. **The game is the reference.** When MineRender differs from vanilla, vanilla wins. Unsupported behavior is stated plainly instead of hidden.
3. **One scene for everything.** New features join the shared renderer and scene; they do not add a separate wrapper per content type.
4. **Same API on every platform.** Browser, Node, embed, and API share asset and scene behavior, so an example on one surface works on the others.
5. **The caller's assets come first.** Resource packs, versions, and custom sources are first-class inputs, not afterthoughts.
