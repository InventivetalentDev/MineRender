import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Converter, ReflectionKind } from "typedoc";
import { MarkdownPageEvent, MarkdownRendererEvent } from "typedoc-plugin-markdown";

// Match declaration paths rather than barrel files so new exports join their feature automatically.
const sections = [
    {
        id: "rendering", title: "Rendering & scenes",
        match: /^(renderer\/|export\/|instance\/|inspector\/|three\/OrbitControls|SceneStats\.ts|Ticker\.ts|AnimatorFunction\.ts|Transformable\.ts)/,
        primary: ["Renderer", "RendererOptions", "MineRenderScene", "SceneObject", "SceneExporter"],
        description: "Create and control a scene, manage object transforms, animate frames, and export the result."
    },
    {
        id: "skins", title: "Skins & capes", match: /^skin\//,
        primary: ["SkinObject", "SkinObjectOptions", "Skins", "SkinPart", "CapeLayout"],
        description: "Load player skins and capes, select classic or slim arms, and address individual body parts."
    },
    {
        id: "entities", title: "Entities & animation", match: /^(entity\/|assets\/Entities\.ts)/,
        primary: ["EntityObject", "EntityObjectOptions", "Entities", "EntityAnimation", "EntityAnimationOptions"],
        description: "Load entity layers, select textures and passes, and play keyframe animations."
    },
    {
        id: "worlds", title: "Worlds & file formats", match: /^(world\/|model\/multiblock\/|nbt\/|util\/BatchedExecutor\.ts)/,
        primary: ["MineRenderWorld", "MineRenderWorldOptions", "AnvilParser", "StructureParser", "SchematicParser"],
        description: "Place and edit blocks, load structures and Anvil regions, and manage chunk data and section meshes."
    },
    {
        id: "models", title: "Blocks & item models", match: /^(model\/|assets\/(?:Models|BlockStates|BlockEntities)\.ts)/,
        primary: ["BlockObject", "BlockObjectOptions", "ModelObject", "Models", "BlockStates"],
        description: "Resolve blockstates and item models, select display poses, and configure their geometry and appearance."
    },
    {
        id: "guis", title: "GUIs", match: /^gui\//,
        primary: ["GuiObject", "GuiObjectOptions", "GuiLayer", "GuiHelper", "GuiRecipe"],
        description: "Compose ordered texture and item layers in GUI pixel coordinates."
    },
    {
        id: "assets", title: "Assets & resource packs", match: /^(assets\/(?!ModelTextures\.ts)|MinecraftAsset\.ts|ListAsset\.ts)/,
        primary: ["AssetLoader", "AssetKey", "HostedAssetSource", "ArchiveAssetSource", "BrowserArchiveProxy"],
        description: "Address versioned assets, layer hosted sources and resource packs, and parse loaded data."
    },
    {
        id: "textures", title: "Textures & materials",
        match: /^(texture\/|image\/|canvas\/|assets\/ModelTextures\.ts|Materials\.ts|UVMapper\.ts|WrappedImage\.ts|ExtractableImageData\.ts|Minecraft(?:CubeTexture|TextureMeta)\.ts|TintColors\.ts)/,
        primary: ["Textures", "TextureLoader", "TextureAtlas", "Materials", "ModelTextures"],
        description: "Work with image decoding, texture atlases, animated textures, and shared materials."
    },
    {
        id: "platforms", title: "Platforms & lifecycle", match: /^(env\/|Env\.ts|shutdown\.ts|Disposable\.ts|cache\/|request\/)/,
        primary: ["Env", "EnvProvider", "BrowserEnv", "NodeEnv", "shutdown"],
        description: "Inspect platform providers, shared caches, request queues, and final shutdown. Browser and Node entry points add their own providers."
    },
    {
        id: "utilities", title: "Utilities & supporting types", match: /.*/,
        primary: ["Axis", "CubeFace", "Geometries", "Meshes", "MineRenderError"],
        description: "Find geometry helpers, errors, type guards, and exported data formats, including the Bedrock type declarations."
    }
];

const threeBases = {
    Object3D: "core/Object3D",
    Scene: "scenes/Scene",
    Group: "objects/Group",
    Mesh: "objects/Mesh",
    InstancedMesh: "objects/InstancedMesh"
};

export function load(app) {
    app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
        // Keep MineRender base-class methods and dependency types; three.js documents its inherited members.
        for (const reflection of Object.values(context.project.reflections)) {
            if (reflection.inheritedFrom && reflection.sources?.length &&
                reflection.sources.every(source => /\/node_modules\/(?:@types\/three|three)\//.test(source.fullFileName.replaceAll("\\", "/")))) {
                context.project.removeReflection(reflection);
            }
        }
    });

    app.renderer.on(MarkdownPageEvent.END, (page) => {
        if (!page.model.kindOf(ReflectionKind.Class) || !page.contents) return;
        const base = page.model.extendedTypes?.find(type => threeBases[type.name]);
        if (base) {
            page.contents += `\n\n## Inherited three.js API\n\nMembers inherited from [${base.name}](https://threejs.org/docs/#api/en/${threeBases[base.name]}) are documented by three.js. MineRender overrides are listed above.\n`;
        }
    });

    app.renderer.on(MarkdownRendererEvent.END, (event) => {
        const symbols = event.pages.filter(page => page.model.parent?.kindOf(ReflectionKind.Module) &&
            !page.model.kindOf(ReflectionKind.Module | ReflectionKind.Reference));
        const sidebar = sections.map(section => {
            const entries = symbols.filter(page => {
                const path = page.model.sources?.[0]?.fullFileName.replaceAll("\\", "/").split("/src/").pop() || "";
                return sections.find(candidate => candidate.match.test(path)) === section;
            }).sort((a, b) => a.model.name.localeCompare(b.model.name));
            const item = page => ({ text: page.model.name, link: `/api/${page.url.replace(/\.md$/, "")}` });
            const primary = section.primary.map(name => entries.find(page => page.model.name === name)).filter(Boolean);
            const other = entries.filter(page => !primary.includes(page));
            const table = pages => "| API | Kind |\n| --- | --- |\n" + pages.map(page =>
                `| [${page.model.name}](${item(page).link}) | ${ReflectionKind.singularString(page.model.kind)} |`).join("\n");
            writeFileSync(join(event.outputDirectory, `${section.id}.md`),
                `# ${section.title}\n\n${section.description}\n\n## Main API\n\n${table(primary)}\n\n## Supporting API\n\n${table(other)}\n`);
            return {
                text: section.title, link: `/api/${section.id}`, collapsed: true,
                items: [...primary.map(item), { text: "Supporting API", collapsed: true, items: other.map(item) }]
            };
        });
        writeFileSync(join(event.outputDirectory, "sidebar.json"), JSON.stringify(sidebar, null, 2));
    });
}
