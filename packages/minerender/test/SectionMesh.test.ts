import test, { ExecutionContext } from "ava";
import { BoxGeometry, Float32BufferAttribute, Matrix4, Mesh, ShaderMaterial, Texture } from "three";
import { CanvasImage } from "../src/canvas/CanvasImage";
import { CompatCanvas } from "../src/canvas/CanvasCompat";
import { Env, EnvProvider } from "../src/Env";
import { TextureAtlas } from "../src/texture/TextureAtlas";
import { SectionMesh, SectionMeshTemplate } from "../src/world/SectionMesh";

function fixture(t: ExecutionContext) {
    const provider = Env["_provider"];
    Env.register({ name: "test", createCanvas: (width, height) => ({
        width, height, getContext: () => ({ drawImage() {} })
    } as unknown as CompatCanvas) } as EnvProvider);
    const geometries: BoxGeometry[] = [];
    t.teardown(() => { Env["_provider"] = provider; for (const geometry of geometries) geometry.dispose(); });
    return (): SectionMeshTemplate => {
        const geometry = new BoxGeometry(16, 16, 16);
        geometries.push(geometry);
        return { geometry, atlas: new TextureAtlas({}, new CanvasImage(2, 2), {}, {}, false, {}, false),
            cullFaces: [1, 2, 4, 8, 16, 32] };
    };
}

test.serial("section faces retain baked rotation, tint and atlas UVs without changing shared templates", t => {
    const create = fixture(t);
    const first = create(), second = create();
    first.geometry.applyMatrix4(new Matrix4().makeRotationY(Math.PI / 2));
    first.geometry.setAttribute("color", new Float32BufferAttribute(Array.from({ length: 24 }, () => [0.25, 0.5, 0.75]).flat(), 3));
    const source = first.geometry.toJSON();
    let sourceDisposals = 0;
    first.geometry.addEventListener("dispose", () => { sourceDisposals++; });
    const section = SectionMesh.build([
        { index: 1, template: first, cullMask: 1 },
        { index: 16, template: second, cullMask: 0 },
        { index: 256, template: first, cullMask: 63 }
    ], 4);
    t.is(section.children.length, 1);
    const mesh = section.children[0] as Mesh;
    const geometry = mesh.geometry;
    const material = mesh.material as ShaderMaterial;
    const texture = material.uniforms.map.value as Texture;
    t.is(geometry.getAttribute("position").count, 44);
    t.is(geometry.getIndex()!.count, 66);
    t.deepEqual(geometry.boundingBox!.min.toArray(), [-8, -8, -8]);
    t.deepEqual(geometry.boundingBox!.max.toArray(), [24, 8, 24]);
    t.true(Math.abs(geometry.getAttribute("normal").getZ(0) - 1) < 1e-6);
    t.deepEqual(Array.from(geometry.getAttribute("color").array).slice(0, 3), [0.25, 0.5, 0.75]);
    t.deepEqual(Array.from(geometry.getAttribute("color").array).slice(-3), [1, 1, 1]);
    t.deepEqual([texture.image.width, texture.image.height], [4, 2]);
    t.deepEqual([geometry.getAttribute("uv").getX(0), geometry.getAttribute("uv").getY(0)], [0, 1]);
    t.deepEqual([geometry.getAttribute("uv").getX(20), geometry.getAttribute("uv").getY(20)], [0.5, 1]);
    t.deepEqual(first.geometry.toJSON(), source);
    const disposed = { geometry: 0, material: 0, texture: 0 };
    geometry.addEventListener("dispose", () => { disposed.geometry++; });
    material.addEventListener("dispose", () => { disposed.material++; });
    texture.addEventListener("dispose", () => { disposed.texture++; });
    section.dispose();
    section.dispose();
    t.deepEqual(disposed, { geometry: 1, material: 1, texture: 1 });
    t.is(sourceDisposals, 0);
    t.is(section.children.length, 0);
    t.deepEqual([first.atlas.image.width, first.atlas.image.height], [2, 2]);
});

test.serial("section atlases page at the size limit, share repeated sources and keep untagged faces", t => {
    const create = fixture(t);
    const templates = [create(), create(), create()];
    const section = SectionMesh.build([...templates, templates[0]].map((template, index) => ({
        index, template: { ...template, cullFaces: [0, 2, 4, 8, 16, 32] }, cullMask: 63
    })), 2);
    t.teardown(() => section.dispose());
    t.is(section.children.length, 3);
    t.deepEqual(section.children.map(child => (child as Mesh).geometry.getIndex()!.count), [12, 6, 6]);
    for (const child of section.children) {
        const canvas = ((child as Mesh).material as ShaderMaterial).uniforms.map.value.image;
        t.deepEqual([canvas.width, canvas.height], [2, 2]);
    }
    const empty = SectionMesh.build([{ index: 0, template: templates[0], cullMask: 63 }], 2);
    t.is(empty.children.length, 0);
    empty.dispose();
});
