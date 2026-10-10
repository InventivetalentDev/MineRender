import test from "ava";
import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, Group, InstancedMesh, Matrix4, Mesh, MeshBasicMaterial, ShaderMaterial, Texture, Vector3 } from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { SceneExporter } from "../src/export/SceneExporter";
import { Env, EnvProvider } from "../src/Env";
import type { CompatCanvas } from "../src/canvas/CanvasCompat";

function triangle(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.setAttribute("normal", new Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
    geometry.setAttribute("uv", new Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
    geometry.setIndex([0, 1, 2]);
    return geometry;
}

test("OBJ expands live instances, excludes hidden ancestors, and leaves source resources and matrices intact", t => {
    const root = new Group();
    root.position.set(10, 20, 30);
    root.clone = () => { throw new Error("Scene objects must not be cloned"); };
    root.userData.root = root;
    const geometry = triangle();
    const material = new MeshBasicMaterial();
    material.userData.root = root;
    const instances = new InstancedMesh(geometry, material, 5);
    instances.count = 3;
    instances.position.set(2, 0, 0);
    instances.setMatrixAt(0, new Matrix4().makeTranslation(0, 3, 0));
    instances.setMatrixAt(1, new Matrix4().makeScale(0, 0, 0));
    instances.setMatrixAt(2, new Matrix4().makeTranslation(0, 0, 4));
    root.add(instances);
    const hidden = new Group();
    hidden.visible = false;
    hidden.add(new Mesh(geometry, material));
    root.add(hidden);
    const invisibleMesh = new Mesh(geometry, material);
    invisibleMesh.visible = false;
    root.add(invisibleMesh);
    const positions = Array.from(geometry.getAttribute("position").array);
    const matrices = Array.from(instances.instanceMatrix.array);
    let disposed = false;
    geometry.addEventListener("dispose", () => { disposed = true; });
    material.addEventListener("dispose", () => { disposed = true; });

    const output = SceneExporter.toObj(root);
    const vertices = output.split("\n").filter(line => line.startsWith("v "));
    t.deepEqual(vertices, ["v 12 23 30", "v 13 23 30", "v 12 24 30", "v 12 20 34", "v 13 20 34", "v 12 21 34"]);
    t.is(output.split("\n").filter(line => line.startsWith("f ")).length, 2);
    t.is(output.split("\n").filter(line => line.startsWith("vt ")).length, 6);
    t.deepEqual(root.matrix.elements, new Matrix4().elements);
    t.deepEqual(root.matrixWorld.elements, new Matrix4().elements);
    t.deepEqual(instances.matrix.elements, new Matrix4().elements);
    t.deepEqual(Array.from(instances.instanceMatrix.array), matrices);
    t.deepEqual(Array.from(geometry.getAttribute("position").array), positions);
    t.is(instances.material, material);
    t.is(material.userData.root, root);
    t.false(disposed);
});

test("OBJ preserves outward winding after reflected parent transforms and honors explicit local matrices", t => {
    const parent = new Group();
    parent.position.x = 5;
    parent.scale.x = -2;
    const mesh = new Mesh(triangle(), new MeshBasicMaterial());
    mesh.matrixAutoUpdate = false;
    mesh.matrix.makeTranslation(3, 0, 0);
    mesh.position.x = 100;
    parent.add(mesh);
    const output = SceneExporter.toObj(mesh);
    const vertices = output.split("\n").filter(line => line.startsWith("v ")).map(line => new Vector3(...line.slice(2).split(" ").map(Number) as [number, number, number]));
    t.deepEqual(vertices.map(vertex => vertex.toArray()), [[-1, 0, 0], [-3, 0, 0], [-1, 1, 0]]);
    t.true(output.includes("f 1/1/1 3/3/3 2/2/2"));
    t.deepEqual(Array.from(mesh.geometry.index!.array), [0, 1, 2]);
    parent.visible = false;
    t.is(SceneExporter.toObj(mesh), "");
});

test("PLY retains instance and vertex colors, supports binary output in Node, and excludes hidden material groups", t => {
    const geometry = triangle();
    geometry.setAttribute("color", new Float32BufferAttribute([1, 0.5, 1, 1, 0.5, 1, 1, 0.5, 1], 3));
    geometry.setIndex([0, 1, 2, 2, 1, 0]);
    geometry.addGroup(0, 3, 0);
    geometry.addGroup(3, 3, 1);
    const visible = new MeshBasicMaterial({ vertexColors: true });
    const hidden = new MeshBasicMaterial({ visible: false });
    const mesh = new InstancedMesh(geometry, [visible, hidden], 1);
    mesh.setColorAt(0, new Color(0.25, 1, 0.5));
    const output = SceneExporter.toPLY(mesh) as string;
    const vertex = output.split("end_header\n")[1].split("\n")[0];
    const expected = new Color(0.25, 0.5, 0.5).convertLinearToSRGB().toArray();
    t.true(output.includes("element vertex 3\n"));
    t.true(output.includes("element face 1\n"));
    t.true(output.includes("property float red\nproperty float green\nproperty float blue\n"));
    t.deepEqual(vertex.split(" ").slice(-3).map(Number), expected);
    const binary = SceneExporter.toPLY(mesh, { binary: true, littleEndian: true }) as ArrayBuffer;
    t.true(binary instanceof ArrayBuffer);
    t.true(new TextDecoder().decode(binary.slice(0, 80)).includes("format binary_little_endian 1.0"));
    const headerEnd = new TextDecoder().decode(binary).indexOf("end_header\n") + "end_header\n".length;
    const binaryColors = expected.map((_, i) => new DataView(binary).getFloat32(headerEnd + (8 + i) * 4, true));
    t.deepEqual(binaryColors, Array.from(new Float32Array(expected)));
    t.deepEqual(Array.from(geometry.getAttribute("color").array), [1, 0.5, 1, 1, 0.5, 1, 1, 0.5, 1]);
    t.deepEqual(Array.from(mesh.instanceColor!.array), [0.25, 1, 0.5]);
    geometry.setDrawRange(3, 3);
    t.is(SceneExporter.toObj(mesh), "");
});

test("draw ranges omit unused vertices from exported geometry and bounds", t => {
    const geometry = triangle();
    geometry.setAttribute("position", new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 50, 0, 0, 51, 0, 0, 50, 1, 0], 3));
    geometry.deleteAttribute("normal");
    geometry.deleteAttribute("uv");
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    geometry.setDrawRange(0, 3);
    const mesh = new Mesh(geometry, new MeshBasicMaterial());
    const output = SceneExporter.toObj(mesh);
    t.deepEqual(output.split("\n").filter(line => line.startsWith("v ")), ["v 0 0 0", "v 1 0 0", "v 0 1 0"]);
    t.true((SceneExporter.toPLY(mesh) as string).includes("element vertex 3\n"));
    t.is(geometry.getAttribute("position").count, 6);
    t.deepEqual(geometry.drawRange, { start: 0, count: 3 });
});

test("geometry exports accept atlas shaders without DOM, and glTF reports its browser requirement", async t => {
    const texture = new Texture();
    const material = new ShaderMaterial({ vertexColors: true, uniforms: {
        map: { value: texture }, SHADE: { value: true }, BRIGHTNESS: { value: 1 }, EMISSIVE: { value: false }
    } });
    const geometry = triangle();
    geometry.setAttribute("color", new Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    const mesh = new Mesh(geometry, material);
    let disposed = false;
    texture.addEventListener("dispose", () => { disposed = true; });
    t.true(SceneExporter.toObj(mesh).includes("f 1/1/1 2/2/2 3/3/3"));
    const green = new Color(0, 1, 0).convertLinearToSRGB().g;
    t.true((SceneExporter.toPLY(mesh) as string).includes(`0 ${green} 0`));
    await t.throwsAsync(SceneExporter.toGLTF(mesh), { message: /requires a browser/ });
    t.is(material.uniforms.map.value, texture);
    t.false(disposed);
});

test.serial("static exports omit item glint without duplicating or changing the base mesh", async t => {
    const parse = GLTFExporter.prototype.parseAsync;
    const browser = { document: globalThis.document, FileReader: globalThis.FileReader };
    t.teardown(() => {
        GLTFExporter.prototype.parseAsync = parse;
        for (const [key, value] of Object.entries(browser)) {
            if (value === undefined) delete (globalThis as any)[key];
            else (globalThis as any)[key] = value;
        }
    });
    (globalThis as any).document = {};
    (globalThis as any).FileReader = class {};
    GLTFExporter.prototype.parseAsync = async root => ({ meshes: (root as Group).children });
    const texture = new Texture();
    const material = new ShaderMaterial({ uniforms: {
        map: { value: texture }, SHADE: { value: true }, BRIGHTNESS: { value: 1 }, EMISSIVE: { value: false }
    } });
    const mesh = new Mesh(triangle(), material);
    const pass = new Mesh(mesh.geometry, new ShaderMaterial());
    pass.userData.minerenderItemGlint = true;
    mesh.add(pass);
    let disposed = false;
    for (const resource of [mesh.geometry, material, pass.material, texture]) {
        resource.addEventListener("dispose", () => { disposed = true; });
    }
    t.is(SceneExporter.toObj(mesh).split("\n").filter(line => line.startsWith("f ")).length, 1);
    t.true((SceneExporter.toPLY(mesh) as string).includes("element face 1\n"));
    const result = await SceneExporter.toGLTF(mesh) as { meshes: Mesh<BufferGeometry, MeshBasicMaterial>[] };
    t.is(result.meshes.length, 1);
    t.is(result.meshes[0].material.map, texture);
    t.is(mesh.children[0], pass);
    t.true(pass.visible);
    t.false(disposed);
});

test.serial("glTF keeps opaque atlas regions depth-writing while retaining fractional overlays and source texture state", async t => {
    const provider = Env["_provider"];
    const parse = GLTFExporter.prototype.parseAsync;
    const browser = { document: globalThis.document, FileReader: globalThis.FileReader };
    t.teardown(() => {
        Env["_provider"] = provider;
        GLTFExporter.prototype.parseAsync = parse;
        for (const [key, value] of Object.entries(browser)) {
            if (value === undefined) delete (globalThis as any)[key];
            else (globalThis as any)[key] = value;
        }
    });
    (globalThis as any).document = {};
    (globalThis as any).FileReader = class {};
    Env.register({ name: "test", createCanvas: (width, height) => ({ width, height, getContext: () => ({
        createImageData: () => ({ data: new Uint8ClampedArray(width * height * 4) }), putImageData: () => {}
    }) }) as unknown as CompatCanvas } as EnvProvider);
    GLTFExporter.prototype.parseAsync = async root => ({ meshes: (root as Group).children });

    const pixels = new Uint8Array(4 * 2 * 4).fill(255);
    for (const pixel of [2, 3]) pixels[pixel * 4 + 3] = 128;
    pixels[5 * 4 + 3] = 0;
    const texture = new DataTexture(pixels, 4, 2);
    texture.flipY = true;
    const transformed = texture.clone();
    transformed.offset.x = 0.25;
    const source = texture.source;
    const version = source.version;
    const material = new MeshBasicMaterial({ map: texture, transparent: true, alphaTest: 0.1 });
    const root = new Group();
    const add = (name: string, x: number, y: number, mat = material) => {
        const geometry = triangle();
        geometry.setAttribute("uv", new Float32BufferAttribute([x, y, x + 0.5, y, x, y + 0.5], 2));
        const mesh = new Mesh(geometry, mat);
        mesh.name = name;
        root.add(mesh);
        return geometry;
    };
    add("base", 0, 0.5);
    add("overlay", 0.5, 0.5);
    add("cutout", 0, 0, new MeshBasicMaterial({ map: texture, transparent: true }));
    add("transformed", 0, 0.5, new MeshBasicMaterial({ map: transformed, transparent: true, alphaTest: 0.1 }));
    add("vertex alpha", 0, 0.5, new MeshBasicMaterial({ map: texture, transparent: true, vertexColors: true }))
        .setAttribute("color", new Float32BufferAttribute([1, 1, 1, 0.5, 1, 1, 1, 0.5, 1, 1, 1, 0.5], 4));

    const output = await SceneExporter.toGLTF(root) as { meshes: Mesh<BufferGeometry, MeshBasicMaterial>[] };
    t.deepEqual(output.meshes.map(mesh => [mesh.name, mesh.material.transparent]), [
        ["base", false], ["overlay", true], ["cutout", false], ["transformed", true], ["vertex alpha", true]
    ]);
    t.is(output.meshes[0].material.alphaTest, 0.1);
    t.true(output.meshes[0].material.depthWrite);
    t.is(output.meshes[2].material.alphaTest, 1 / 255);
    t.not(output.meshes[0].material.map!.source, source);
    t.true(output.meshes[0].material.map!.flipY);
    t.is(texture.source, source);
    t.is(source.version, version);
    t.true(material.transparent);
    t.is(material.alphaTest, 0.1);
    t.is(material.map, texture);
    t.is(pixels[2 * 4 + 3], 128);
});
