# MineRender V2 reference

Find API signatures, options, and the behavior shared across MineRender features. The reference complements the website's live examples with details about rendering, resource ownership, and platform support.

## Find a feature

Start with the main API for the content you want to render. Related options and types appear beside it in the navigation.

| Feature | Main APIs |
| --- | --- |
| [Rendering and scenes](/api/rendering) | [Renderer](/api/index/classes/Renderer), [RendererOptions](/api/index/interfaces/RendererOptions), [MineRenderScene](/api/index/classes/MineRenderScene), [FlyControls](/api/index/classes/FlyControls) |
| [Player skins and capes](/api/skins) | [Skins](/api/index/classes/Skins), [SkinObject](/api/index/classes/SkinObject), [SkinObjectOptions](/api/index/interfaces/SkinObjectOptions) |
| [Blocks and item models](/api/models) | [Models](/api/index/classes/Models), [ItemModelContext](/api/index/interfaces/ItemModelContext), [BlockStates](/api/index/classes/BlockStates), [ModelObject](/api/index/classes/ModelObject), [BlockObject](/api/index/classes/BlockObject), [ItemDefaults](/api/index/classes/ItemDefaults), [ItemTints](/api/index/classes/ItemTints) |
| [Entities and animation](/api/entities) | [Entities](/api/index/classes/Entities), [EntityObject](/api/index/classes/EntityObject), [EntityAnimation](/api/index/interfaces/EntityAnimation) |
| [Worlds and file formats](/api/worlds) | [MineRenderWorld](/api/index/classes/MineRenderWorld), [WorldStreamer](/api/index/classes/WorldStreamer), [AnvilWorldSource](/api/index/classes/AnvilWorldSource), [StructureParser](/api/index/classes/StructureParser), [SchematicParser](/api/index/classes/SchematicParser), [SpongeSchematicParser](/api/index/classes/SpongeSchematicParser), [LitematicaParser](/api/index/classes/LitematicaParser), [AnvilParser](/api/index/classes/AnvilParser) |
| [GUI layers, text, and layouts](/api/guis) | [GuiObject](/api/index/classes/GuiObject), [GuiLayer](/api/index/type-aliases/GuiLayer), [GuiHelper](/api/index/classes/GuiHelper), [GuiText](/api/index/type-aliases/GuiText), [Fonts](/api/index/classes/Fonts), [layoutGuiText](/api/index/functions/layoutGuiText) |
| [Assets and resource packs](/api/assets) | [AssetKey](/api/index/classes/AssetKey), [AssetLoader](/api/index/classes/AssetLoader), [HostedAssetSource](/api/index/classes/HostedAssetSource), [ArchiveAssetSource](/api/index/classes/ArchiveAssetSource), [MineRenderData](/api/index/classes/MineRenderData), [Renames](/api/index/classes/Renames), [Biomes](/api/index/classes/Biomes) |
| [Images, videos, and model exports](/api/rendering) | [Renderer](/api/index/classes/Renderer), [VideoExportOptions](/api/index/interfaces/VideoExportOptions), [SceneExporter](/api/index/classes/SceneExporter), [SceneGLTFExportOptions](/api/index/interfaces/SceneGLTFExportOptions) |
| [Scene documents](/api/scenes) | [SceneDocument](/api/index/interfaces/SceneDocument), [SceneDocumentLoader](/api/index/classes/SceneDocumentLoader), [encodeSceneDocument](/api/index/functions/encodeSceneDocument), [decodeSceneDocument](/api/index/functions/decodeSceneDocument) |
| [Node rendering, logging, and lifecycle](/api/platforms) | [NodeRenderer](/api/index.node/classes/NodeRenderer), [RendererSurface](/api/index/interfaces/RendererSurface), [Logging](/api/index/classes/Logging), [shutdown](/api/index/functions/shutdown) |

## Shared behavior

[Core concepts](./concepts.md) explains coordinate units, asynchronous initialization, versioned registry data, redraws, animation, item state, world rendering and streaming, logging, and cleanup. Read it when a change does not appear on screen or when several objects share rendering resources.

[Browser and Node.js](./platforms.md) explains package imports, native PNG rendering with `NodeRenderer`, and the capabilities each environment provides.

[Iframe embeds](./embeds.md) explains the `/embed/` page's URL parameters, scene links, and size limits.

## Reading the API

Feature groups keep classes with their options and supporting types. Use search to find an exact symbol or method name.

Many scene objects extend three.js classes. MineRender adds asset loading, named parts, dirty notifications, and instance handling; direct changes to inherited three.js properties still follow the [redraw rules](./concepts.md#redrawing-after-changes).
