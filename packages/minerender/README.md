# MineRender V2

A TypeScript library for interactive Minecraft skins, models, blocks, entities, and worlds.
V2 is in beta. See the [roadmap](https://github.com/InventivetalentDev/MineRender/blob/main/ROADMAP.md) for feature parity and remaining work.

Install the beta package with its three.js peer:

```sh
yarn add minerender@beta three@^0.186.1
```

In a browser application:

```ts
import { Renderer } from "minerender";

const renderer = new Renderer();
renderer.appendTo(document.body);
renderer.start();
```

The package provides ESM and CommonJS entries for browsers and Node.js, plus
`dist/bundle.js` for the `MineRender` browser global. Node imports require the optional
native `canvas` dependency; headless rendering is still in development.

Requires Node.js 22.12+ or a browser with WebGL 2, Fetch, `AbortSignal.any()`, and `AbortSignal.timeout()`.

## Resource-pack ZIPs

Register a browser `File` or `Blob` before loading models or textures:

```ts
import { ArchiveAssetSource, AssetLoader, Caching } from "minerender";

AssetLoader.setVersion("1.21.11");
AssetLoader.addSource("pack", ArchiveAssetSource.blob(resourcePackFile));
Caching.clear();
```

`ArchiveAssetSource` reads the root `pack.mcmeta` once. Matching overlays take
precedence in reverse declaration order, followed by the pack's base files.
Both legacy `formats` ranges and modern `min_format`/`max_format` ranges are
supported. A pack's `filter.block` rules suppress matching files in lower-priority
sources, including contributions to combined fonts; the pack's own files remain available.

Packs with overlays lazily resolve the selected Minecraft version's resource and
data pack formats from [mcmeta's extracted version metadata](https://github.com/misode/mcmeta).
For offline use or versions absent from that dataset, pass explicit formats:

```ts
const pack = ArchiveAssetSource.blob(resourcePackFile, { resourcePackFormat: [75, 0] });
```

A number selects minor version zero. Use `dataPackFormat` separately for files
under `data/`. Packs without overlays make no version-metadata request. Missing
`pack.mcmeta` keeps plain archive loading; invalid metadata rejects the lookup.

Filter expressions use JavaScript regular expressions with substring matching.
Namespace and path matches can come from different rules, following vanilla's
filter behavior. Paths include the asset type and extension, such as
`textures/block/stone.png`. Java-only regular expression syntax is not supported.
