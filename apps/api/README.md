# Rendering API

Create PNGs from MineRender [scene documents](../../packages/minerender/src/scene/SceneDocument.ts) with `POST /v1/renders`. A request can combine skins, blocks, items, models, entities, and GUI layers. Rendering runs in separate Node processes through `NodeRenderer`.

This API deliberately replaces the V1 server contract. It does not implement `GET /render/skin/:texture`, `GET /render/model/:type/:model`, or the `minerender-options` header. Submit a scene once, then use the returned PNG URL in an `<img src>` while the resource remains cached. A GET retrieves an existing image; it does not create a render.

## Start the server

Use Node.js 22.12 or later and install the [native rendering dependencies](../../packages/minerender/reference/platforms.md). Run these commands from the repository root:

```sh
yarn install
yarn build:api
yarn start:api
```

The server listens at `http://127.0.0.1:3000`. On a headless Linux host, start it with `xvfb-run -a yarn start:api` after installing the native dependencies.

## Create and download a render

1. Submit a scene. This example renders a grass block at 512 × 512 pixels with a transparent background:

   ```sh
   curl --fail-with-body http://127.0.0.1:3000/v1/renders \
     -H 'Content-Type: application/json' \
     --data '{
       "scene": {
         "format": "minerender-scene",
         "version": 1,
         "objects": [
           { "id": "block", "type": "block", "asset": "minecraft:grass_block" }
         ]
       },
       "output": { "width": 512, "height": 512, "format": "png" }
     }' > render.json
   ```

   The response contains a completed render resource. `image.width` and `image.height` report the PNG's dimensions, including any trimming:

   ```json
   {
     "id": "RENDER_ID",
     "status": "completed",
     "createdAt": "2026-10-09T12:00:00.000Z",
     "expiresAt": "2026-10-09T12:10:00.000Z",
     "image": {
       "href": "/v1/renders/RENDER_ID/image",
       "mediaType": "image/png",
       "width": 512,
       "height": 512
     }
   }
   ```

2. Download the PNG using the returned path:

   ```sh
   IMAGE_PATH=$(node -p 'JSON.parse(require("node:fs").readFileSync("render.json", "utf8")).image.href')
   curl --fail-with-body "http://127.0.0.1:3000${IMAGE_PATH}" --output render.png
   ```

The POST waits for rendering and returns `201 Created`, with `Location: /v1/renders/RENDER_ID`. An equivalent cached or in-progress request reuses the resource and returns `200 OK`. Reordering JSON keys or omitting the default `output` fields and `minecraftVersion` does not change the resource ID.

## Request format

`scene` uses the library's versioned `minerender-scene` format. `scene.minecraftVersion` defaults to `1.21.11`. The camera fits the visible scene unless `scene.camera.position` and `scene.camera.target` are supplied. Positions use model units (16 per block); rotations use radians.

The optional `output` object accepts these fields:

| Field | Default | Accepted values |
|---|---|---|
| `width`, `height` | `512` | Integers from 1 through 2048; at most 4,194,304 pixels |
| `format` | `"png"` | `"png"` |
| `trim` | `false` | Trim transparent edges when `true` |
| `background` | `null` | Transparent when `null`; otherwise an RGB integer from `0` through `16777215` |

Scenes contain 1–32 objects. Skin and cape inputs accept Minecraft usernames, UUIDs, or HTTPS texture URLs at `textures.minecraft.net/texture/HEX_HASH`. Other external URLs, local paths, and data URLs are rejected. Resource-pack uploads and custom asset roots are not part of this API. Asset downloads are limited to 8 MiB each and 64 MiB in total per render.

## Resource endpoints

| Method and path | Result |
|---|---|
| `POST /v1/renders` | Create or reuse a completed render |
| `GET /v1/renders/RENDER_ID` | Read resource metadata |
| `GET /v1/renders/RENDER_ID/image` | Download the PNG |
| `GET /healthz` | Check that the HTTP server is running |

GET endpoints also support HEAD. PNG responses include an `ETag`; send it in `If-None-Match` to receive `304 Not Modified` when unchanged. Resource metadata is not cached by HTTP clients. PNG responses use private caching for the resource's remaining lifetime.

Resources live in a bounded memory cache and expire after 10 minutes by default. The server evicts least recently used resources when it reaches its byte or entry limit, so a resource can disappear before `expiresAt`. Expired, evicted, and unknown resources return `404 Not Found`; submit the scene again to recreate one. Restarting the server clears the cache.

Errors use `application/problem+json` with `type`, `title`, `status`, and `detail`. Invalid JSON returns `400`; unsupported content types return `415`; oversized bodies return `413`; invalid scene or output fields return `422`. A full render queue returns `503` with `Retry-After`, a deadline returns `504`, and a failed render returns `502`.

## Configure limits

Set environment variables before starting the server:

| Variable | Default | Purpose |
|---|---|---|
| `HOST` | `127.0.0.1` | Bind address |
| `PORT` | `3000` | HTTP port |
| `RENDER_CONCURRENCY` | `2` | Maximum worker processes in the render pool |
| `RENDER_MAX_QUEUE` | `8` | Maximum waiting renders |
| `RENDER_TIMEOUT_MS` | `45000` | Request deadline, including queue time |
| `RENDER_CACHE_BYTES` | `67108864` | Maximum cached PNG bytes (64 MiB) |
| `RENDER_CACHE_TTL_MS` | `600000` | Resource lifetime (10 minutes) |
| `RENDER_MAX_BODY_BYTES` | `262144` | Maximum JSON request size (256 KiB) |
| `RENDER_ASSET_ORIGINS` | Empty | Comma-separated trusted HTTPS origins to allow in addition to the defaults |

The PNG cache also holds at most 256 resources. Identical concurrent requests share one render. A disconnected client cancels its render when no other client is waiting for it. Shutdown aborts queued and active renders.

Each worker handles one render at a time and retains the library's memory and disk asset caches between requests. Workers retire after 100 renders. Cancellation or a deadline terminates the active worker, and later work uses a replacement. A worker's asset caches are cleared when it is replaced or the service closes; they do not persist across server restarts. These caches are separate from the bounded PNG cache.

Asset downloads allow `assets.mcasset.cloud`, the `minerender-fallback-assets` repository on `raw.githubusercontent.com`, the skin resolver at `mcproxy.dev`, and textures at `textures.minecraft.net`. To allow additional upstream hosts or redirect destinations, set `RENDER_ASSET_ORIGINS`, or pass `assetOrigins: string[]` to `createRenderServer`. Each entry must be an HTTPS origin, such as `https://assets.example.com`. This setting does not expand the request format to accept arbitrary URLs or add fallback skin resolvers.

This server has no authentication and binds to localhost by default. Add access controls at your deployment boundary before exposing it to other users.

After building, run `yarn test:api` to check HTTP behavior with an injected renderer. Run `yarn test:api:native` to verify PNG output through an actual native render process; on headless Linux, use `xvfb-run -a yarn test:api:native`. Neither suite downloads Minecraft assets.
