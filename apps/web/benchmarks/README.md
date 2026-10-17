# Benchmark world streaming

Run a fixed chunk route against a local Java save and export timing, frame-callback, and JavaScript heap measurements. The runner opens a fresh Chrome profile, serves only the selected dimension's region and external chunk files on localhost, and leaves the save unchanged. It uses the existing library source, parser, world, and section worker without changing their behavior.

From the repository root:

```sh
yarn build:lib
yarn workspace @minerender/web benchmark:world \
  --world "SAVE_FOLDER" --version 1.16.2 \
  --route '[[-15,8],[-7,8],[1,8],[9,8]]' \
  --output /tmp/world-streaming.json
```

Replace `SAVE_FOLDER` with the save's folder. Choose its Minecraft asset version explicitly; the default is `1.21.11`. Route coordinates are absolute chunk columns, not block coordinates. The return route runs automatically without repeating the turning point. Without `--route`, the runner selects a populated chunk near `0,0` and generates four eastward stops. Selecting the default route reads region headers before measurement.

The default load radius is 1, unload radius is 2, viewport is 1280×720 at pixel ratio 1, and each stop settles for 1,000 ms. Rendering runs without a frame limit during measurement. Set `--dimension nether` or `--dimension end` for the other vanilla dimensions. Run `--help` for lighting, biome blending, entity rendering, section meshing, cache limits, route, and timeout options. Set `CHROME_PATH` to use a Chrome binary outside the default macOS installation.

Chrome uses its selected GPU by default. `--software-rendering` requests SwiftShader for validation on machines without usable GPU rendering; those results describe software rendering. `--headed` shows the browser. The report records the browser, actual WebGL renderer, operating system, revision, settings, and hashes of every world file requested. Missing files are listed separately. Benchmark results and save files do not belong in Git.

## Profile placement

Add `--profile-placement` to the command above. This option records placement stages and requires section meshing.

The runner instruments four built ESM modules in memory while bundling the benchmark. It leaves library source, package files, and the section worker unchanged. If a method or measured boundary has changed, bundling fails instead of silently omitting that measurement. Without the flag, the runner uses the ordinary benchmark bundle.

The report's `placementProfile` contains:

- `events`: timed spans with IDs, explicit parent IDs, pass, phase, and waypoint. Section builds and their child stages include absolute section coordinates, including the vertical section coordinate. State and model preparation events identify their block or model; they have no section assignment.
- `summary`: build totals per pass, split into `ownColumnBuilds`, `neighborBuilds`, `unloadBuilds`, and `otherBuilds`, plus `sectionsBuiltTwiceInOneOperation` for sections built at least twice within one operation.
- `sections`: counts by pass and section coordinates (`x`, `y`, `z`), with `builds`, `succeeded`, the same operation split, `maxBuildsPerOperation`, `inclusiveMs`, and `unionMs`.
- `stages`: call counts, successes, summed `inclusiveMs`, and `unionMs` by pass and stage, including cleanup. The union counts overlapping intervals of that stage once. Different stages can overlap or contain each other, so neither column can be added across stages to calculate total streaming time. Filter `events` by `phase` to exclude cleanup.
- `issues` and `incompleteSpans`: missing ownership or unfinished instrumentation. The runner exits unsuccessfully if it detects these issues.

Stage boundaries are:

| Stage | Includes |
|---|---|
| `state-preparation` | Selecting prepared state/templates and resolving tints, including cache hits and waits |
| `state-resolution` | The state cache's loader: model resolution, model atlases, and rotation data |
| `template-preparation` / `template-build` | Template cache lookup/wait / the cache loader's geometry creation |
| `model-atlas` | Creating a model texture atlas, including awaited texture loads; warm caches can skip this stage |
| `section-rebuild` | A rebuild attempt, including neighborhood preparation, mesh replacement, and attempts that need no build |
| `section-build` / `section-input` | A mesh build / conversion of its entries and templates to worker input |
| `worker-roundtrip` | Worker dispatch through reply, including queueing, message cloning, and main-thread scheduling; this is not worker CPU time |
| `synchronous-geometry` | Geometry built on the main thread when no worker is available or a worker rejects |
| `mesh-assembly` / `atlas-paint` | Page canvases, geometry, materials, bounds, and subscriptions / its nested canvas allocation and image painting |

Profiling adds clock reads, span records, promise continuations, and retained JavaScript memory. Use ordinary runs for performance comparisons. Profiled times describe the instrumented run, and its heap includes profiler records. The worker hash stays unchanged; the instrumented main script has a different hash. Both are recorded in the report.

## Read the report

Each invocation has two passes. The first starts with fresh browser asset storage and a fresh `AnvilWorldSource`; the second keeps loaded assets and the renderer but creates a fresh world and source. Shared GPU resources and shader programs can also remain warm. Within each pass, returning to earlier stops reloads columns while raw region files can remain cached. The runner serves save files with `Cache-Control: no-store`.

The report separates these measurements:

| Measurement | Meaning |
|---|---|
| Source reads | Wall time for region or external-chunk fetches, including the local HTTP response and buffer allocation |
| Parsing | Wall time for `AnvilParser.parseChunk` or `parseEntityChunk`, including decompression and any awaited external `.mcc` read |
| Source total | Wall time for `AnvilWorldSource.getChunk`, including reads, parsing, and coordinate checks |
| Placement, unloading, section builds | Wall time for each operation; section builds include worker dispatch, replies, atlas preparation, and scene geometry creation |
| Update and rendering | Time to finish streaming at a stop, followed by synchronous `renderOnce()` calls; render return does not mean GPU completion or presentation |
| Frame callbacks | `requestAnimationFrame` interval percentiles and intervals over 50 ms during streaming and settling; callback cadence is not displayed FPS |
| JavaScript heap | Observed sampled peak, settled heap, and heap after forced garbage collection when available; these omit GPU memory and may miss allocations while JavaScript is blocked |

Each stop records loaded, pending, missing, and failed columns, drawing calls and triangles, Three.js geometry and texture counts, and evidence of worker replies or synchronous fallback. Cleanup is timed separately. Garbage collection runs after frame sampling, so its pause is excluded from streaming and frame measurements. Heap samples include shared assets and benchmark records that remain after world cleanup. The runner exits unsuccessfully for source failures or browser errors and preserves completed reports for inspection.

Unloading records one operation per group of columns the streamer removes together, with its `columnCount` and `columns`.

## Compare runs

Use the same unchanged save, asset version, route, radii, rendering options, viewport, GPU, Chrome build, and settle duration. Choose stops far enough apart to exceed the unload radius. Check that each stop loads terrain and that worker replies confirm the intended geometry path. Repeat the command at least three times and compare the spread before attributing a difference to a code change. CDN latency affects the first pass; warm asset results help separate it from placement costs.
