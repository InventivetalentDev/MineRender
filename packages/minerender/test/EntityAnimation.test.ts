import test, { ExecutionContext } from "ava";
import { Euler, Matrix4, MeshBasicMaterial, Object3D } from "three";
import { AssetKey, BasicAssetKey } from "../src/assets/AssetKey";
import { AssetLoader } from "../src/assets/AssetLoader";
import { Entities } from "../src/assets/Entities";
import { AssetSource } from "../src/assets/source/AssetSource";
import { AssetParser } from "../src/assets/source/parser/AssetParsers";
import { Caching } from "../src/cache/Caching";
import { Materials } from "../src/Materials";
import { EntityObject } from "../src/entity/scene/EntityObject";
import { EntityAnimation, EntityAnimationFile, EntityAnimationKeyframe, entityAnimationTime, sampleEntityAnimation, sampleEntityKeyframes } from "../src/entity/EntityAnimation";
import type { EntityLayer, EntityModelPart } from "../src/entity/EntityModel";
import type { MinecraftAsset } from "../src/MinecraftAsset";
import type { TripleArray } from "../src/model/Model";
import type { Maybe } from "../src/util";

const rounded = (values: ArrayLike<number>) => Array.from(values, value => Math.round(value * 1e6) / 1e6);
const keyframe = (time: number, value: TripleArray, interpolation: "linear" | "catmullrom" = "linear", pre?: TripleArray): EntityAnimationKeyframe =>
    ({ time, value, interpolation, ...(pre && { pre }) });

test("linear keyframes hold outside their range and use the later keyframe's interpolation and pre value", t => {
    const keyframes = [keyframe(1, [0, 0, 0], "catmullrom"), keyframe(3, [2, 4, -6]), keyframe(5, [0, 0, 0], "linear", [10, 4, -6])];
    t.deepEqual(sampleEntityKeyframes(keyframes, 0), [0, 0, 0]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 1), [0, 0, 0]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 2), [1, 2, -3]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 3), [2, 4, -6]);
    // The arrival value applies before the boundary; the keyframe's own value applies at it.
    t.deepEqual(sampleEntityKeyframes(keyframes, 4), [6, 4, -6]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 5), [0, 0, 0]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 9), [0, 0, 0]);
    t.deepEqual(sampleEntityKeyframes([keyframe(2, [1, 2, 3], "catmullrom")], 7), [1, 2, 3]);
    t.deepEqual(sampleEntityKeyframes([], 1), [0, 0, 0]);
});

test("catmull-rom keyframes use the four surrounding values with clamped indexes", t => {
    const keyframes = [0, 1, 3, 4].map((value, time) => keyframe(time, [value, 0, -value], "catmullrom"));
    t.deepEqual(sampleEntityKeyframes(keyframes, 0.5), [0.375, 0, -0.375]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 1.5), [2, 0, -2]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 2.5), [3.625, 0, -3.625]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 2), [3, 0, -3]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 8), [4, 0, -4]);
    // A linear keyframe between spline keyframes interpolates its own segment only.
    keyframes[2].interpolation = "linear";
    t.deepEqual(sampleEntityKeyframes(keyframes, 1.5), [2, 0, -2]);
    t.deepEqual(sampleEntityKeyframes(keyframes, 0.5), [0.375, 0, -0.375]);
});

test("dataset keyframes sample to vanilla's values and loop by the animation length", t => {
    // minecraft:warden roar, head rotation (first four keyframes) and minecraft:bat flying, right_wing rotation.
    const head = [
        keyframe(0, [0, 0, 0], "catmullrom"), keyframe(1.24, [-0.567232, 0, 0], "catmullrom"),
        keyframe(1.6, [-0.567232, 0, -0.47996554], "catmullrom"), keyframe(1.8, [-0.567232, 0, 0.4537856], "catmullrom")
    ];
    t.deepEqual(rounded(sampleEntityKeyframes(head, 1.6)), rounded(head[2].value));
    t.deepEqual(rounded(sampleEntityKeyframes(head, 1.42)), [-0.602684, 0, -0.298342]);

    const flying: EntityAnimation = {
        length: 0.5, loop: true, bones: {
            right_wing: { rotation: [keyframe(0, [0, 1.4835298, 0]), keyframe(0.125, [0, -0.9599311, 0]), keyframe(0.25, [0, 0.87266463, 0]), keyframe(0.5, [0, 1.4835298, 0])] },
            body: { position: [keyframe(0, [0, 0, 0]), keyframe(0.125, [0, -2, 0])], scale: [] }
        }
    };
    const pose = sampleEntityAnimation(flying, 0.0625);
    t.deepEqual(Object.keys(pose.body), ["position"]);
    t.deepEqual(pose.body.position, [0, -1, 0]);
    t.deepEqual(rounded(pose.right_wing.rotation!), [0, 0.261799, 0]);
    t.deepEqual(sampleEntityAnimation(flying, 2.0625), pose);
    t.is(entityAnimationTime(flying, 1.75), 0.25);
    // Without looping the last keyframe holds.
    t.deepEqual(sampleEntityAnimation(flying, 2.0625, false).right_wing.rotation, [0, 1.4835298, 0]);
    t.deepEqual(sampleEntityAnimation({ ...flying, loop: false }, 0.5625, true), pose);
});

class StubSource extends AssetSource {
    constructor(private readonly load: (key: AssetKey, parser: AssetParser | string) => unknown) { super(); }
    async get<T extends MinecraftAsset>(key: AssetKey, parser: AssetParser | string): Promise<Maybe<T>> {
        return this.load(key, parser) as Maybe<T>;
    }
}

test.serial("animations load from the dataset's animation tree per version and a missing file is not an error", async t => {
    const originalRoot = AssetLoader.ROOT;
    const originalSources = [...AssetLoader["_SOURCES"]];
    Caching.clear();
    AssetLoader["_SOURCES"] = [];
    t.teardown(() => {
        AssetLoader.ROOT = originalRoot;
        AssetLoader["_SOURCES"] = originalSources;
        Caching.clear();
    });
    const file: EntityAnimationFile = { id: "minecraft:warden", animations: { roar: { length: 4.2, loop: false, bones: {} } } };
    const requests: string[] = [];
    AssetLoader.addSource("test", new StubSource((key, parser) => {
        t.is(parser, AssetParser.JSON);
        t.is(key.assetType, undefined);
        const root = key.root ?? AssetLoader.ROOT;
        requests.push(`${ root }/${ key.rootType }/${ key.namespace }/${ key.path }${ key.extension }`);
        return root !== "https://example.test/1.18.2" && key.path === "warden" ? file : undefined;
    }));

    AssetLoader.ROOT = "https://example.test/1.21.11";
    const key = new BasicAssetKey("minecraft", "warden");
    t.is(await Entities.getAnimations(key), file.animations);
    t.is(await Entities.getAnimations(AssetKey.parse("entities", "warden")), file.animations);
    t.is(await Entities.getAnimations(new BasicAssetKey("minecraft", "cow")), undefined);
    // A version without animations has no file; the newer version's result must not be reused.
    AssetLoader.ROOT = "https://example.test/1.18.2";
    t.is(await Entities.getAnimations(key), undefined);
    const custom = new AssetKey("minecraft", "warden", undefined, undefined, "entity-models", ".json", "https://pack.example/custom");
    t.is(await Entities.getAnimations(custom), file.animations);
    t.is(await Entities.getAnimations(custom), file.animations);
    t.deepEqual(requests, [
        "https://example.test/1.21.11/entity-models/animations/minecraft/warden.json",
        "https://example.test/1.21.11/entity-models/animations/minecraft/cow.json",
        "https://example.test/1.18.2/entity-models/animations/minecraft/warden.json",
        "https://pack.example/custom/entity-models/animations/minecraft/warden.json"
    ]);
});

const part = (options: Partial<EntityModelPart> = {}): EntityModelPart => ({
    pose: { offset: [0, 0, 0], rotation: [0, 0, 0] }, cubes: [], children: {}, ...options
});

function fixture(t: ExecutionContext) {
    const original = Materials.getImage;
    const material = new MeshBasicMaterial();
    Materials.getImage = () => material;
    Caching.clear();
    t.teardown(() => {
        Materials.getImage = original;
        material.dispose();
        Caching.clear();
    });
    const root = () => part({
        pose: { offset: [1, 2, 3], rotation: [0, 0, 0] },
        children: {
            body: part({ pose: { offset: [0, -21, 0], rotation: [0.1, 0.2, 0.3], scale: [1, 2, 1] }, children: { head: part({ pose: { offset: [0, -13, 0], rotation: [0, 0, 0] } }) } })
        }
    });
    const layer = (): EntityLayer => ({ key: new BasicAssetKey("minecraft", "fixture"), layer: { texture: [64, 64], root: root() } });
    const main = layer();
    const layers = { main, "main#2": main, wool: layer() };
    const object = new EntityObject({ ...layers.main, id: "minecraft:fixture", layers });
    object["createMeshes"]();
    const scene = Object.assign(new Object3D(), { isMineRenderScene: true, dirty: false });
    scene.add(object);
    const state = (name: string, layerName: string = "main") => {
        const group = object.getGroupByName(name, layerName)!;
        return rounded([...group.position.toArray(), group.rotation.x, group.rotation.y, group.rotation.z, ...group.scale.toArray()]);
    };
    const wasDirty = () => {
        const dirty = scene.dirty;
        scene.dirty = false;
        return dirty;
    };
    return { object, state, wasDirty };
}

const animation: EntityAnimation = {
    length: 2, loop: false, bones: {
        root: { position: [keyframe(0, [0, 0, 0]), keyframe(2, [0, 8, 0])] },
        body: {
            position: [keyframe(0, [0, 0, 0]), keyframe(2, [2, 4, 6])],
            rotation: [keyframe(0, [0, 0, 0]), keyframe(2, [1, -0.5, 0.25])],
            scale: [keyframe(0, [-1, -1, -1]), keyframe(2, [0.5, 1, 0])]
        },
        left_ear: { rotation: [keyframe(0, [1, 1, 1])] }
    }
};

test("playback targets the named layer and its repeated draws without changing other layers", t => {
    const { object, state, wasDirty } = fixture(t);
    const rest = { root: [1, 2, 3, 0, 0, 0, 1, 1, 1], body: [0, -21, 0, 0.1, 0.2, 0.3, 1, 2, 1], head: [0, -13, 0, 0, 0, 0, 1, 1, 1] };

    object.playAnimation(animation);
    t.is(object.animation, animation);
    t.true(wasDirty());
    // Scale is stored as an offset: -1 hides a part of scale 1.
    t.deepEqual(state("body"), [0, -21, 0, 0.1, 0.2, 0.3, 0, 1, 0]);

    object.setAnimationTime(1);
    t.true(wasDirty());
    for (const layer of ["main", "main#2"]) {
        t.deepEqual(state("root", layer), [1, 6, 3, 0, 0, 0, 1, 1, 1]);
        t.deepEqual(state("body", layer), [1, -19, 3, 0.6, -0.05, 0.425, 0.75, 2, 0.5]);
        t.deepEqual(state("head", layer), rest.head);
    }
    for (const [name, values] of Object.entries(rest)) t.deepEqual(state(name, "wool"), values);
    // Offsets add to vanilla's Euler angles: translate, rotate Z, then Y, then X, then scale.
    const body = object.getGroupByName("body", "main")!;
    body.updateMatrix();
    const expected = new Matrix4().makeTranslation(1, -19, 3)
        .multiply(new Matrix4().makeRotationZ(0.425)).multiply(new Matrix4().makeRotationY(-0.05)).multiply(new Matrix4().makeRotationX(0.6))
        .multiply(new Matrix4().makeScale(0.75, 2, 0.5));
    t.deepEqual(rounded(body.matrix.elements), rounded(expected.elements));
    t.is(body.rotation.order, "ZYX");

    // Every update starts from the default pose, so repeated and backward updates do not accumulate.
    object.setAnimationTime(1);
    object.setAnimationTime(0.5);
    object.setAnimationTime(1);
    t.deepEqual(state("body"), [1, -19, 3, 0.6, -0.05, 0.425, 0.75, 2, 0.5]);

    object.stopAnimation();
    t.is(object.animation, undefined);
    t.true(wasDirty());
    for (const [name, values] of Object.entries(rest)) t.deepEqual(state(name, "main#2"), values);
    object.stopAnimation();
    object.setAnimationTime(1);
    object.advanceAnimation(1);
    t.false(wasDirty());
    t.deepEqual(state("body"), rest.body);
});

test("advancing applies baked offsets and restores the caller's pose when stopped", t => {
    const { object, state, wasDirty } = fixture(t);
    object.getGroupByName("head", "main")!.rotation.set(0.5, 0, 0, "ZYX");
    object.getGroupByName("body", "main")!.position.y = 99;
    const nod: EntityAnimation = { length: 1, loop: true, bones: { head: { rotation: [keyframe(0, [0, 0, 0]), keyframe(1, [1, 0, 0])] } } };

    object.playAnimation(nod, { speed: 2, time: 0.25 });
    t.is(object.getGroupByName("body", "main")!.position.y, -21);
    t.deepEqual(state("head").slice(3, 6), [0.25, 0, 0]);
    object.advanceAnimation(0.125);
    t.is(object.animationTime, 0.5);
    t.true(wasDirty());
    t.deepEqual(state("head").slice(3, 6), [0.5, 0, 0]);
    object.advanceAnimation(0.375);
    t.deepEqual(state("head").slice(3, 6), [0.25, 0, 0]);

    // Replacing playback keeps the saved caller pose; without looping the last keyframe holds.
    object.playAnimation(nod, { loop: false });
    t.deepEqual(state("head").slice(3, 6), [0, 0, 0]);
    object.advanceAnimation(5);
    t.deepEqual(state("head").slice(3, 6), [1, 0, 0]);
    object.stopAnimation();
    t.deepEqual(state("head").slice(3, 6), [0.5, 0, 0]);
    t.is(object.getGroupByName("body", "main")!.position.y, 99);
    t.deepEqual(state("head", "wool").slice(3, 6), [0, 0, 0]);
});

test("layer clips share playback time, validate before replacing, and restore their caller poses together", t => {
    const { object, state } = fixture(t);
    const wool: EntityAnimation = { length: 2, loop: false, layer: "wool", bones: {
        body: { position: [keyframe(0, [0, 2, 0]), keyframe(2, [0, 6, 0])] }
    } };
    object.getGroupByName("body", "wool")!.position.set(4, 5, 6);
    object.playAnimations([animation, wool], { speed: 2, time: 0.5 });
    t.deepEqual(object.activeAnimations, [animation, wool]);
    t.is(object.animation, animation);
    object.advanceAnimation(0.25);
    t.is(object.animationTime, 1);
    t.deepEqual(state("body").slice(0, 3), [1, -19, 3]);
    t.deepEqual(state("body", "main#2"), state("body"));
    t.deepEqual(state("body", "wool").slice(0, 3), [0, -17, 0]);
    t.throws(() => object.playAnimations([animation, animation]), { message: 'Multiple animations target layer "main"' });
    t.throws(() => object.playAnimation({ ...wool, layer: "missing" }), {
        message: 'Entity minecraft:fixture has no selected animation layer "missing"'
    });
    t.deepEqual(object.activeAnimations, [animation, wool]);
    t.is(object.animationTime, 1);
    object.playAnimations([]);
    t.deepEqual(object.activeAnimations, []);
    t.is(object.animation, undefined);
    t.deepEqual(state("body", "wool").slice(0, 3), [4, 5, 6]);
    t.deepEqual(state("body").slice(0, 3), [0, -21, 0]);
});

test("disposal ends playback", t => {
    const { object, wasDirty } = fixture(t);
    object.playAnimation(animation);
    const body = object.getGroupByName("body", "main")!;
    object.setAnimationTime(1);
    const posed = body.position.toArray();
    object.dispose();
    wasDirty();
    t.is(object.animation, undefined);
    t.is(object.animationTime, 0);
    object.advanceAnimation(1);
    object.setAnimationTime(2);
    object.stopAnimation();
    t.false(wasDirty());
    // Removed parts are neither posed nor restored.
    t.deepEqual(body.position.toArray(), posed);
});
