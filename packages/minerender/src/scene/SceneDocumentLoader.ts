import { Group } from "three";
import type { Object3D } from "three";
import { AssetKey } from "../assets/AssetKey";
import type { BasicMinecraftAsset } from "../MinecraftAsset";
import { DisplayPosition } from "../model/DisplayPosition";
import { MineRenderScene } from "../renderer/MineRenderScene";
import { isSceneObject, SceneObject } from "../renderer/SceneObject";
import type { SceneObjectOptions } from "../renderer/SceneObjectOptions";
import { EntityObject } from "../entity/scene/EntityObject";
import { SkinObject } from "../skin/scene/SkinObject";
import { Skins } from "../skin/Skins";
import { GuiObject } from "../gui/scene/GuiObject";
import { parseSceneDocument, SceneDocument, SceneObjectDefinition } from "./SceneDocument";

export interface LoadedSceneObject {
    readonly root: Group;
    readonly object: SceneObject;
    readonly definition: SceneObjectDefinition;
    /** Advances entity playback in seconds unless the definition has paused it. */
    advanceAnimation(delta: number): void;
    /** Removes this object and releases its owned resources. Safe to call more than once. */
    dispose(): void;
}

export interface LoadedSceneDocument {
    readonly root: Group;
    readonly objects: LoadedSceneObject[];
    readonly definition: SceneDocument;
    advanceAnimations(delta: number): void;
    dispose(): void;
}

// Blocks create models and block entities through their scene, without forwarding a parent.
// A nested scene keeps those visuals inside the object's transform group, including after state changes.
class DocumentObjectScene extends MineRenderScene {
    public async addSceneObject<A extends BasicMinecraftAsset, T extends SceneObject, O extends SceneObjectOptions>(
        _asset: A, supplier: () => T | Promise<T>, _options?: Partial<O>, parent: Object3D = this
    ): Promise<T> {
        const object = await supplier();
        return this.initialize(object, parent);
    }

    public async initialize<T extends SceneObject>(object: T, parent: Object3D = this): Promise<T> {
        object.scene = this;
        try {
            await object.init();
            parent.add(object);
            return object;
        } catch (error) {
            object.dispose();
            object.removeFromParent();
            throw error;
        }
    }

    public dispose(): void {
        for (const child of [...this.children]) {
            if (child.parent !== this) continue;
            if (isSceneObject(child)) child.dispose();
            child.removeFromParent();
        }
    }
}

async function skinTexture(value: string, cape = false): Promise<string> {
    if (!/^[a-zA-Z0-9_-]{1,36}$/.test(value)) return value;
    const texture = await (cape ? Skins.capeFromUuidOrUsername(value) : Skins.fromUuidOrUsername(value));
    if (!texture) throw new Error(`Could not find ${cape ? "cape" : "skin"} for "${value}"`);
    return texture;
}

/** Loads portable scene documents using the asset sources already configured by the caller. */
export class SceneDocumentLoader {
    public static parse(value: unknown): SceneDocument {
        return parseSceneDocument(value);
    }

    /**
     * Loads objects concurrently and attaches them in document order after every load succeeds.
     * A failure waits for all loads, disposes staged objects, and reports the first error in document order.
     */
    public static async load(scene: MineRenderScene, value: unknown, parent: Object3D = scene): Promise<LoadedSceneDocument> {
        const definition = this.parse(value);
        const assets = scene.assets;
        if (definition.minecraftVersion !== undefined && definition.minecraftVersion !== assets.version) {
            throw new Error(`Scene requires Minecraft ${definition.minecraftVersion}; configure the scene asset context for that version before loading it`);
        }
        const root = new Group();
        root.name = "MineRender scene document";
        const objects: LoadedSceneObject[] = [];
        let disposed = false;
        const loaded: LoadedSceneDocument = {
            root, objects, definition,
            advanceAnimations: delta => { if (!disposed) for (const object of objects) object.advanceAnimation(delta); },
            dispose: () => {
                if (disposed) return;
                disposed = true;
                root.removeFromParent();
                for (const object of objects) object.dispose();
                root.clear();
                scene.dirty = true;
            }
        };
        try {
            const results = await Promise.allSettled(definition.objects.map(object => this.loadValidatedObject(scene, object, undefined, assets)));
            for (const result of results) if (result.status === "fulfilled") objects.push(result.value);
            const failure = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
            if (failure) throw failure.reason;
            for (const object of objects) root.add(object.root);
            parent.add(root);
            scene.dirty = true;
            return loaded;
        } catch (error) {
            loaded.dispose();
            throw error;
        }
    }

    /** Loads an independently editable object. Its root owns the document's position, rotation, and scale. */
    public static async loadObject(scene: MineRenderScene, value: SceneObjectDefinition, parent: Object3D = scene): Promise<LoadedSceneObject> {
        const definition = this.parse({ format: "minerender-scene", version: 1, objects: [value] }).objects[0];
        return this.loadValidatedObject(scene, definition, parent);
    }

    private static async loadValidatedObject(scene: MineRenderScene, definition: SceneObjectDefinition, parent?: Object3D, assets = scene.assets): Promise<LoadedSceneObject> {
        const root = new Group();
        root.name = definition.name ?? definition.id;
        root.userData.sceneObjectId = definition.id;
        root.position.fromArray(definition.position ?? [0, 0, 0]);
        root.rotation.set(...(definition.rotation ?? [0, 0, 0]));
        root.scale.fromArray(definition.scale ?? [1, 1, 1]);
        root.visible = definition.visible ?? true;
        const content = new DocumentObjectScene({ assets });
        root.add(content);
        let object: SceneObject | undefined;
        try {
            switch (definition.type) {
                case "skin": {
                    const skin = new SkinObject({ ...definition.options, assets, instanceMeshes: false });
                    object = skin;
                    const texture = definition.skin ? await skinTexture(definition.skin)
                        : `${assets.root}/assets/minecraft/textures/entity/player/${definition.options?.slim ? "slim/alex" : "wide/steve"}.png`;
                    await skin.setSkinTexture(texture);
                    await content.initialize(skin);
                    if (definition.cape) await skin.setCapeTexture(await skinTexture(definition.cape.texture, true), definition.cape.layout);
                    for (const [part, rotation] of Object.entries(definition.pose ?? {})) {
                        skin.getGroupByName(part)?.rotation.set(...rotation, "XYZ");
                    }
                    for (const part of definition.hiddenParts ?? []) {
                        const mesh = skin.getMeshByName(part);
                        if (mesh) mesh.visible = false;
                    }
                    break;
                }
                case "block": {
                    const state = await assets.blockStates.get(AssetKey.parse("blockstates", definition.asset));
                    if (!state) throw new Error(`Could not load block ${definition.asset}`);
                    object = await content.addBlock(state, { ...definition.options, initialState: definition.state, instanceMeshes: false }) as SceneObject;
                    break;
                }
                case "item":
                case "model": {
                    let key = AssetKey.parse("models", definition.asset);
                    if (definition.type === "item" && key.type !== "item") {
                        key = new AssetKey(key.namespace, key.getFullPath(), "models", "item");
                    }
                    const model = await assets.models.getMerged(key);
                    if (!model) throw new Error(`Could not load ${definition.type} ${definition.asset}`);
                    object = await content.addModel(model, { ...(definition.type === "item" ? { displayPosition: DisplayPosition.GUI } : {}),
                        ...definition.options, instanceMeshes: false }) as SceneObject;
                    break;
                }
                case "entity": {
                    const key = AssetKey.parse("entity-models", definition.asset);
                    const model = await assets.entities.getEntity(key, definition.texture ? AssetKey.parse("textures", definition.texture) : undefined, {
                        layers: definition.layers, when: definition.when,
                        textures: definition.textures && Object.fromEntries(Object.entries(definition.textures).map(([name, texture]) => [name, AssetKey.parse("textures", texture)]))
                    });
                    if (!model) throw new Error(`Could not load entity ${definition.asset}`);
                    const entity = await content.addEntity(model, { ...definition.options, instanceMeshes: false }) as EntityObject;
                    object = entity;
                    if (definition.animation) {
                        const animations = await assets.entities.getAnimations(key);
                        const clip = animations?.[definition.animation.name];
                        if (!clip) throw new Error(`Entity ${definition.asset} has no animation "${definition.animation.name}"`);
                        entity.playAnimation(clip, definition.animation);
                    }
                    break;
                }
                case "gui":
                    object = await content.initialize(new GuiObject(definition.layers, { assets }));
                    break;
            }
            let disposed = false;
            const loaded: LoadedSceneObject = {
                root, object, definition,
                advanceAnimation: delta => {
                    if (!disposed && definition.type === "entity" && !definition.animation?.paused) (object as EntityObject).advanceAnimation(delta);
                },
                dispose: () => {
                    if (disposed) return;
                    disposed = true;
                    root.removeFromParent();
                    object!.dispose();
                    object!.removeFromParent();
                    content.dispose();
                    root.clear();
                    scene.dirty = true;
                }
            };
            parent?.add(root);
            scene.dirty = true;
            return loaded;
        } catch (error) {
            object?.dispose();
            object?.removeFromParent();
            content.dispose();
            root.removeFromParent();
            root.clear();
            throw new Error(`Scene object "${definition.name ?? definition.id}": ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
