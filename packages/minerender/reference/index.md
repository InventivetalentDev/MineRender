# MineRender V2 reference

Find API signatures, options, and the behavior shared across MineRender features. The reference complements the website's live examples with details about rendering, resource ownership, and platform support.

## Find a feature

Start with the main API for the content you want to render. Related options and types appear beside it in the navigation.

| Feature | Main APIs |
| --- | --- |
| [Rendering and scenes](/api/rendering) | [Renderer](/api/index/classes/Renderer), [RendererOptions](/api/index/interfaces/RendererOptions), [MineRenderScene](/api/index/classes/MineRenderScene) |
| [Player skins and capes](/api/skins) | [Skins](/api/index/classes/Skins), [SkinObject](/api/index/classes/SkinObject), [SkinObjectOptions](/api/index/interfaces/SkinObjectOptions) |
| [Blocks and item models](/api/models) | [Models](/api/index/classes/Models), [BlockStates](/api/index/classes/BlockStates), [ModelObject](/api/index/classes/ModelObject), [BlockObject](/api/index/classes/BlockObject) |
| [Entities and animation](/api/entities) | [Entities](/api/index/classes/Entities), [EntityObject](/api/index/classes/EntityObject), [EntityAnimation](/api/index/interfaces/EntityAnimation) |
| [Worlds and file formats](/api/worlds) | [MineRenderWorld](/api/index/classes/MineRenderWorld), [StructureParser](/api/index/classes/StructureParser), [SchematicParser](/api/index/classes/SchematicParser), [SpongeSchematicParser](/api/index/classes/SpongeSchematicParser), [AnvilParser](/api/index/classes/AnvilParser) |
| [GUI layers and recipes](/api/guis) | [GuiObject](/api/index/classes/GuiObject), [GuiLayer](/api/index/type-aliases/GuiLayer), [GuiHelper](/api/index/classes/GuiHelper) |
| [Assets and resource packs](/api/assets) | [AssetKey](/api/index/classes/AssetKey), [AssetLoader](/api/index/classes/AssetLoader), [HostedAssetSource](/api/index/classes/HostedAssetSource), [ArchiveAssetSource](/api/index/classes/ArchiveAssetSource) |
| Images and model exports | [Renderer](/api/index/classes/Renderer), [SceneExporter](/api/index/classes/SceneExporter), [SceneGLTFExportOptions](/api/index/interfaces/SceneGLTFExportOptions) |

## Shared behavior

[Core concepts](./concepts.md) explains coordinate units, asynchronous initialization, redraws, and cleanup. Read it when a change does not appear on screen or when several objects share rendering resources.

[Browser and Node.js](./platforms.md) explains package imports and which capabilities each environment provides. Node package support does not include a headless WebGL renderer.

## Reading the API

Feature groups keep classes with their options and supporting types. Use search to find an exact symbol or method name.

Many scene objects extend three.js classes. MineRender adds asset loading, named parts, dirty notifications, and instance handling; direct changes to inherited three.js properties still follow the [redraw rules](./concepts.md#redrawing-after-changes).
