import test from "ava";
import { PerspectiveCamera, Vector3 } from "three";
import type { Camera, WebGLRenderer } from "three";
import { FlyControls, isFlyControls } from "../src/renderer/FlyControls";
import { Renderer } from "../src/renderer/Renderer";
import type { MineRenderScene } from "../src/renderer/MineRenderScene";
import { OrbitControls } from "../src/three/OrbitControls";
import { shutdown } from "../src/shutdown";

type Listener = (event: any) => void;

class FakeTarget {
    readonly listeners = new Map<string, Set<Listener>>();
    addEventListener(type: string, listener: Listener): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
    }
    removeEventListener(type: string, listener: Listener): void {
        this.listeners.get(type)?.delete(listener);
    }
    emit(type: string, event: object = {}): void {
        for (const listener of [...(this.listeners.get(type) ?? [])]) listener({ type, preventDefault() {}, ...event });
    }
    get listenerCount(): number {
        return [...this.listeners.values()].reduce((sum, set) => sum + set.size, 0);
    }
}

class FakeElement extends FakeTarget {
    readonly ownerDocument: FakeDocument;
    readonly style: Record<string, string> = {};
    lockRequests = 0;
    remove(): void {}
    constructor(document: FakeDocument) {
        super();
        this.ownerDocument = document;
    }
    requestPointerLock(): void {
        this.lockRequests++;
        this.ownerDocument.pointerLockElement = this;
        this.ownerDocument.emit("pointerlockchange");
    }
}

class FakeDocument extends FakeTarget {
    pointerLockElement: FakeElement | null = null;
    readonly defaultView = new FakeTarget();
    exitPointerLock(): void {
        this.pointerLockElement = null;
        this.emit("pointerlockchange");
    }
}

function fixture(position = new Vector3(0, 0, 0)) {
    const document = new FakeDocument();
    const element = new FakeElement(document);
    const camera = new PerspectiveCamera();
    camera.position.copy(position);
    const controls = new FlyControls(camera, element as unknown as HTMLElement);
    controls.enableDamping = false;
    let changes = 0;
    controls.addEventListener("change", () => changes++);
    return { document, element, camera, controls, changes: () => changes };
}

const key = (code: string, target?: object) => ({ code, target });

test.after.always(() => shutdown());

test("WASD moves horizontally along the view yaw and space/shift move vertically", t => {
    const { document, camera, controls } = fixture();
    controls.movementSpeed = 10;
    controls.setRotation(0, -Math.PI / 4);

    document.emit("keydown", key("KeyW"));
    controls.update(1);
    t.true(camera.position.distanceTo(new Vector3(0, 0, -10)) < 1e-6, "forward ignores pitch");

    document.emit("keyup", key("KeyW"));
    document.emit("keydown", key("KeyD"));
    document.emit("keydown", key("Space"));
    controls.update(1);
    t.true(camera.position.distanceTo(new Vector3(10, 10, -10)) < 1e-6, "strafe right and climb");

    document.emit("keyup", key("KeyD"));
    document.emit("keyup", key("Space"));
    document.emit("keydown", key("ShiftLeft"));
    document.emit("keydown", key("ControlLeft"));
    controls.update(0.5);
    t.true(camera.position.distanceTo(new Vector3(10, 0, -10)) < 1e-6, "sprint doubles descent");
});

test("diagonal input is normalized and the camera turns with pointer movement", t => {
    const { document, element, camera, controls } = fixture();
    controls.movementSpeed = 10;
    document.emit("keydown", key("KeyW"));
    document.emit("keydown", key("KeyA"));
    controls.update(1);
    t.true(Math.abs(camera.position.length() - 10) < 1e-6);

    controls.setRotation(0, 0);
    controls.lookSpeed = 0.01;
    element.emit("pointerdown", { pointerId: 1, pointerType: "mouse", button: 0 });
    element.emit("pointermove", { pointerId: 1, movementX: 100, movementY: -50 });
    t.true(Math.abs(controls.yaw + 1) < 1e-6);
    t.true(Math.abs(controls.pitch - 0.5) < 1e-6);
    element.emit("pointermove", { pointerId: 1, movementX: 0, movementY: -1000 });
    t.true(Math.abs(controls.pitch - Math.PI / 2) < 1e-6, "pitch clamps to straight up");
    element.emit("pointerup", { pointerId: 1, pointerType: "mouse", button: 0 });
    t.is(element.lockRequests, 0, "a drag does not request pointer lock");
});

test("clicking requests pointer lock, unlocking releases held keys, and dispose removes listeners", t => {
    const { document, element, camera, controls } = fixture();
    controls.movementSpeed = 10;
    const events: string[] = [];
    controls.addEventListener("lock", () => events.push("lock"));
    controls.addEventListener("unlock", () => events.push("unlock"));

    element.emit("pointerdown", { pointerId: 1, pointerType: "mouse", button: 0 });
    element.emit("pointerup", { pointerId: 1, pointerType: "mouse", button: 0 });
    t.is(element.lockRequests, 1);
    t.true(controls.locked);
    t.deepEqual(events, ["lock"]);

    element.emit("pointermove", { pointerId: 7, movementX: 10, movementY: 0 });
    t.true(controls.yaw < 0, "locked mouse look needs no drag");

    document.emit("keydown", key("KeyW", { tagName: "INPUT" }));
    t.true(controls.isPressed("forward"), "editable targets are ignored only while unlocked");
    document.exitPointerLock();
    t.false(controls.locked);
    t.false(controls.isPressed("forward"));
    t.deepEqual(events, ["lock", "unlock"]);

    document.emit("keydown", key("KeyW", { tagName: "INPUT" }));
    t.false(controls.isPressed("forward"));
    document.emit("keydown", key("KeyW"));
    document.defaultView.emit("blur");
    t.false(controls.isPressed("forward"), "window blur releases keys");

    controls.pointerLock = false;
    element.emit("pointerdown", { pointerId: 2, pointerType: "mouse", button: 0 });
    element.emit("pointerup", { pointerId: 2, pointerType: "mouse", button: 0 });
    t.is(element.lockRequests, 1, "pointerLock: false never requests a lock");

    controls.dispose();
    t.is(element.listenerCount + document.listenerCount + document.defaultView.listenerCount, 0);
    t.deepEqual(camera.position.toArray(), [0, 0, 0]);
});

test("damping eases toward the target velocity independent of frame rate", t => {
    const { document, camera, controls } = fixture();
    controls.enableDamping = true;
    controls.movementSpeed = 10;
    document.emit("keydown", key("KeyW"));
    for (let i = 0; i < 60; i++) controls.update(1 / 60);
    const sixty = camera.position.z;
    camera.position.set(0, 0, 0);
    controls.reset();
    document.emit("keydown", key("KeyW"));
    for (let i = 0; i < 30; i++) controls.update(1 / 30);
    t.true(Math.abs(camera.position.z - sixty) < 0.05 * Math.abs(sixty));
    t.true(sixty < 0 && sixty > -10);
});

test("lookAt, saveState, and reset round-trip the pose and report changes", t => {
    const { camera, controls, changes } = fixture(new Vector3(0, 10, 0));
    controls.lookAt(new Vector3(0, 0, 0));
    t.true(Math.abs(controls.pitch + Math.PI / 2) < 1e-6);
    controls.lookAt(new Vector3(10, 10, 0));
    t.true(Math.abs(controls.yaw + Math.PI / 2) < 1e-6);
    t.true(Math.abs(controls.pitch) < 1e-6);
    const before = changes();
    controls.saveState();
    camera.position.set(5, 5, 5);
    controls.setRotation(1, 0.2);
    controls.reset();
    t.deepEqual(camera.position.toArray(), [0, 10, 0]);
    t.true(Math.abs(controls.yaw + Math.PI / 2) < 1e-6);
    t.true(changes() > before);
    t.true(isFlyControls(controls));
    t.false(isFlyControls({}));
});

// Assigned before construction: the base constructor creates the renderer and controls before subclass fields exist.
let pendingElement: FakeElement;

class ControlsRenderer extends Renderer {
    frames = 0;
    loop?: (time: number) => void;

    constructor(element: FakeElement, mode: "orbit" | "fly") {
        pendingElement = element;
        super({ controls: { enabled: true, mode }, composer: { enabled: false }, render: { fpsLimit: 0 },
            camera: { position: [0, 0, 100], lookingAt: [0, 0, 0] } });
        this.start();
    }

    protected createScene(): MineRenderScene { return { dirty: false, clear() {} } as MineRenderScene; }
    protected createCamera(): Camera {
        const camera = new PerspectiveCamera();
        camera.position.set(0, 0, 100);
        return camera;
    }
    protected createComposer(): undefined { return undefined; }
    protected createRenderer(): WebGLRenderer {
        return {
            render: () => this.frames++,
            setAnimationLoop: (loop: ((time: number) => void) | null) => { this.loop = loop ?? undefined; },
            domElement: pendingElement, dispose() {}, forceContextLoss() {}
        } as unknown as WebGLRenderer;
    }
    public init(): void {}
    tick(time: number): void { this.loop?.(time); }
}

test("renderer fly controls keep drawing while a key is held and switch modes in place", t => {
    // The vendored OrbitControls compares its element against the global document at construction.
    const globalDocument = globalThis.document;
    t.teardown(() => { globalThis.document = globalDocument; });
    globalThis.document = {} as Document;
    const document = new FakeDocument();
    const element = new FakeElement(document);
    const renderer = new ControlsRenderer(element, "fly");
    const fly = renderer.controls;
    t.true(isFlyControls(fly));
    t.is(renderer.controlsMode, "fly");
    (fly as FlyControls).enableDamping = false;
    (fly as FlyControls).movementSpeed = 10;
    t.true(Math.abs((fly as FlyControls).yaw) < 1e-6, "initial pose looks at the camera target");

    renderer.tick(0);
    renderer.tick(100);
    t.is(renderer.frames, 1, "clean scene draws once");

    document.emit("keydown", key("KeyW"));
    renderer.tick(200);
    renderer.tick(300);
    t.is(renderer.frames, 3, "held keys mark the scene dirty each frame");
    t.true(Math.abs(renderer.camera.position.z - 98) < 1e-6, "movement uses the frame delta");
    document.emit("keyup", key("KeyW"));
    renderer.tick(400);
    t.is(renderer.frames, 3);

    const orbit = renderer.setControlsMode("orbit");
    t.true(orbit instanceof OrbitControls);
    t.is(renderer.controlsMode, "orbit");
    t.true((orbit as OrbitControls).target.distanceTo(new Vector3(0, 0, 0)) < 1e-6, "orbit targets the point in view at the original distance");
    t.true(renderer.dirty);
    t.is(renderer.setControlsMode("orbit"), orbit);
    t.is(document.listenerCount, 0, "disposed fly controls removed their document listeners");

    document.emit("keydown", key("KeyW"));
    renderer.tick(500);
    renderer.tick(600);
    t.true(Math.abs(renderer.camera.position.z - 98) < 1e-6, "orbit mode ignores fly keys");

    const back = renderer.setControlsMode("fly");
    t.true(isFlyControls(back));
    t.true(Math.abs(renderer.camera.position.z - 98) < 1e-6, "switching keeps the camera in place");

    renderer.dispose();
    t.is(renderer.controls, undefined);
    t.is(renderer.controlsMode, undefined);
    t.is(renderer.setControlsMode("orbit"), undefined);
    t.is(element.listenerCount + document.listenerCount, 0);
});
