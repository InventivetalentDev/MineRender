import test from "ava";
import { BoxGeometry, Intersection, Mesh, MeshBasicMaterial, Vector3 } from "three";
import { SceneInspector } from "../src/inspector/SceneInspector";
import { SceneObject } from "../src/renderer/SceneObject";

test("selection keeps the nearest mesh and resolves the original reference for an instance hit", t => {
    const geometry = new BoxGeometry(), material = new MeshBasicMaterial();
    const owner = new SceneObject();
    const mesh = owner["createInstancedMesh"]("fixture", geometry, material, 1);
    owner.add(mesh);
    const instance = owner.nextInstance();
    t.teardown(() => { owner.dispose(); geometry.dispose(); material.dispose(); });
    const nearby = new Mesh(geometry, material);
    const hits: Intersection[] = [
        { object: nearby, distance: 1, point: new Vector3() },
        { object: mesh, instanceId: instance.index, distance: 2, point: new Vector3() }
    ];
    const inspector = Object.create(SceneInspector.prototype) as SceneInspector;
    let selected: Parameters<SceneInspector["selectObject"]> | undefined;
    inspector.selectObject = (...args) => { selected = args; };
    inspector["handleRaycasterObjects"](hits);
    t.is(selected?.[0], nearby);
    t.is(selected?.[1], hits[0]);
    t.is(selected?.[2], undefined);
    inspector["handleRaycasterObjects"]([hits[1]]);
    t.is(selected?.[0], owner);
    t.is(selected?.[1], hits[1]);
    t.is(selected?.[2], instance);
});
