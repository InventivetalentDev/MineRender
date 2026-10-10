# Iframe embeds

The embed page displays a scene without loading MineRender into the parent page.
`apps/embed/` builds it as a separate Cloudflare Worker. Its configured destination
is `https://beta.minerender.org/embed/`; deployment is a separate step. The examples
below use that destination.

```html
<iframe
  src="https://beta.minerender.org/embed/?item=minecraft:diamond_sword"
  title="Diamond sword"
  width="320"
  height="320"
  loading="lazy"
  style="border:0;max-width:100%;height:auto;aspect-ratio:1;">
</iframe>
```

Embeds follow the iframe size, fit the scene when no camera is supplied, and pause
rendering while off-screen or in a hidden tab. Load errors appear inside the iframe.
The page exposes a URL API; it does not accept or send `postMessage` commands.

## Choose a scene source

Use exactly one source. Unknown or duplicate parameters are rejected.

| Source | Example | Use |
| --- | --- | --- |
| Shorthand | `?skin=Notch`, `?item=minecraft:diamond_sword`, `?entity=minecraft:creeper`, `?model=minecraft:block/stone` | One object |
| Block shorthand | `?block=minecraft:oak_stairs[facing=east,half=top]` | One block with optional state properties |
| Encoded scene | `#scene=v1.…` | A portable `SceneDocument`, including poses, item components, GUI layers, and animation settings |
| Remote scene | `?src=https%3A%2F%2Fexample.com%2Fscene.json` | HTTPS scene JSON fetched without credentials; the server must allow CORS from the embed host |

`skin` accepts a username, UUID, HTTPS texture URL, or PNG data URL. Use URL encoding
for nested URLs and values with reserved characters. Skin shorthand also accepts
`skin.slim=true|false`, `cape=<username|UUID|HTTPS texture URL>`, and
`cape.layout=minecraft|optifine|labymod`. The default cape layout is `minecraft`.
Entity shorthand accepts `animate=<clip name>` and loops that clip. These modifiers
are only accepted with their matching shorthand, not with `src` or `#scene`.

In the scene editor, **Copy embed** creates iframe HTML with the document, current
camera, background, and viewport aspect ratio. It includes imported skin/cape PNGs
as data URLs. Remote textures still need HTTPS and CORS access from the embed host.

## View options

Camera coordinates use scene units: one Minecraft block is 16 units. For camera
position, target, and Minecraft version, a URL value overrides the document value.
Missing values use automatic framing and the library's default asset version.

| Parameter | Default | Accepted values |
| --- | --- | --- |
| `controls` | `true` | `true` or `false`; enables mouse/touch controls |
| `controls.rotate` | `true` | `true` or `false` |
| `controls.zoom` | `false` | `true` or `false` |
| `controls.pan` | `false` | `true` or `false` |
| `autorotate` | `0` | Degrees per second, from `-360` to `360`; also works with controls disabled |
| `camera.position` | Document value or automatic | `x,y,z`, each from `-1000000` to `1000000` |
| `camera.target` | Document value or scene center | `x,y,z`; position and target must differ |
| `background` | `transparent` | `transparent` or a six-digit RGB color, such as `19212d` |
| `shadow` | `false` | `true` or `false`; applies a CSS drop shadow to the canvas |
| `pixelRatio` | `1` | `0.25` to `4`, subject to drawing-buffer limits |
| `version` | Document value or library default | Minecraft asset version, such as `1.21.11` |

For example, `?entity=minecraft:creeper&autorotate=20&background=19212d` adds a
slow orbit and an opaque background. In an HTML attribute, write `&amp;` between
parameters.

## Scene links and limits

The shared `encodeSceneDocument` and `decodeSceneDocument` functions work with the
scene schema independently of the embed app. Encoding uses UTF-8 JSON, zlib-wrapped
deflate, and unpadded base64url, prefixed with `v1.`. The prefix versions the encoding;
the document's `version` field versions the scene schema.

```ts
import { encodeSceneDocument } from "minerender";

const url = new URL("https://beta.minerender.org/embed/");
url.hash = `scene=${await encodeSceneDocument({
    format: "minerender-scene",
    version: 1,
    objects: [{ id: "preview", type: "item", asset: "minecraft:diamond_sword" }]
})}`;
```

Both codec functions validate the document and limit compressed data and
uncompressed JSON to 1 MiB each. They require native `CompressionStream` and
`DecompressionStream`. The embed also caps remote scene JSON at 1 MiB and fetches it
with a 15-second timeout. PNG data URLs count toward the document size.

Before requesting rendering assets, the embed validates one to 32 objects, at most
128 GUI layers, and at most 8,192 GUI text characters across the scene. It also bounds
transforms, animation values, and GUI dimensions. Drawing buffers are limited to
4,096 pixels per side and 4,194,304 pixels in total by reducing the effective pixel
ratio. A remote `src` avoids a long URL but does not bypass scene limits.

## V1 query compatibility

Existing `minerender.org/embed/skin` and `minerender.org/embed/model` URLs remain V1
pages. The V2 page accepts only these additional query forms:

| V1 query | V2 behavior |
| --- | --- |
| `skin.name`, `skin.url` | Aliases for `skin`; supply only one |
| `cape.user`, `cape.url` | Aliases for `cape`; supply only one, with skin shorthand |
| `models=minecraft:block/stone,minecraft:item/apple` | Creates model objects at their default positions |
| `controls`, `controls.zoom`, `controls.rotate`, `controls.pan`, `camera.position`, `shadow` | Uses the view options above |

`skin.data` and `cape.data` are rejected; use PNG data URLs in a scene document.
`showAxes` is unsupported. `autoResize` is rejected because embeds always follow
their iframe size. There is no CORS proxy or `CORSpipe.php` replacement.

## Run from the repository

Run `yarn dev:embed`, then open
`http://127.0.0.1:3001/embed/?block=minecraft:stone`. To make the local editor generate
local iframe URLs, run `EMBED_URL=http://127.0.0.1:3001/embed/ yarn dev:web` in a
second terminal.

`yarn build:embed` builds the library and the embed into `apps/embed/dist/`.
`yarn test:embed` checks URL parsing, scene limits, and remote loading. `yarn preview:embed` serves the
Worker locally through Wrangler; `yarn deploy:embed` publishes its configured routes.
