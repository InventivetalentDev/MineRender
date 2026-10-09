import {
    AssetKey, AssetLoader, Entities, Renderer, SceneDocumentLoader, SceneExporter, isEntityObject,
    type LoadedSceneObject, type SceneDocument, type SceneObjectDefinition, type SceneSkinDefinition, type SceneEntityDefinition
} from "minerender";
import { Box3, Box3Helper, Color, GridHelper, Group, Raycaster, Vector2, Vector3 } from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { renderInspector } from "./inspector";
import { getObjectList, getObjectListHint, validateMinecraftVersion } from "./catalog";
import { importStructure } from "./imports";

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const viewport = element<HTMLDivElement>("viewport");
const status = element<HTMLSpanElement>("status");
const properties = element<HTMLFieldSetElement>("properties");
const objectList = element<HTMLDivElement>("objects");
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const storageKey = "minerender-scene-editor-v1";
const emptyDocument = (): SceneDocument => ({ format: "minerender-scene", version: 1, minecraftVersion: AssetLoader.version, objects: [] });

function equalJson(left: unknown, right: unknown): boolean {
    if (left === right) return true;
    if (!left || !right || typeof left !== "object" || typeof right !== "object"
        || Array.isArray(left) !== Array.isArray(right)) return false;
    const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length
        && keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && equalJson(a[key], b[key]));
}

function report(message: string, error = false): void {
    status.textContent = message;
    status.classList.toggle("error", error);
}

function download(data: string | ArrayBuffer | Blob | object, filename: string, mime = "application/json"): void {
    const dataUrl = typeof data === "string" && data.startsWith("data:");
    const url = dataUrl ? data : URL.createObjectURL(data instanceof Blob ? data : new Blob([
        typeof data === "string" || data instanceof ArrayBuffer ? data : JSON.stringify(data, null, 2)
    ], { type: mime }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    if (!dataUrl) setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function start(): Promise<void> {
    const renderer = new Renderer({
        camera: { position: [90, 65, 110], lookingAt: [0, 12, 0], near: 0.1, far: 20000 },
        composer: { enabled: false }, controls: { enabled: true },
        render: { antialias: true, autoResize: false, pixelRatio: Math.min(devicePixelRatio, 2) }
    });
    renderer.appendTo(viewport);
    renderer.scene.background = new Color("#19212d");
    const content = new Group();
    const grid = new GridHelper(512, 32, 0x53677b, 0x303f51);
    grid.position.y = -0.05;
    const bounds = new Box3();
    const selectionBox = new Box3Helper(bounds, 0xa0dfb4);
    selectionBox.visible = false;
    const transform = new TransformControls(renderer.camera, renderer.renderer.domElement);
    const transformHelper = transform.getHelper();
    renderer.scene.add(content, grid, selectionBox, transformHelper);
    renderer.registerEventDispatcher(transform);
    renderer.start();
    const observer = new ResizeObserver(() => renderer.resize(viewport.clientWidth, viewport.clientHeight));
    observer.observe(viewport);

    let sceneDocument = emptyDocument();
    let objects = new Map<string, LoadedSceneObject>();
    let selectedId: string | undefined;
    let cleanupInspector: (() => void) | undefined;
    let unsubscribeAnimation: (() => void) | undefined;
    let busy = false;
    let capturing = false;
    let recording: AbortController | undefined;
    let disposed = false;
    let history: string[] = [];
    let historyIndex = -1;
    let catalogGeneration = 0;
    let localSaveProtected = false;
    const pendingUpdates = new Set<Promise<void>>();
    const loadingObjects = new Map<string, symbol>();
    const animationRequests = new Map<string, symbol>();
    const vectorInputs = new Map<string, HTMLInputElement[]>();

    const selected = () => sceneDocument.objects.find(object => object.id === selectedId);
    const currentObject = () => selectedId ? objects.get(selectedId) : undefined;
    const snapshot = (): SceneDocument => ({
        ...clone(sceneDocument),
        camera: {
            position: renderer.camera.position.toArray() as [number, number, number],
            target: renderer.controls!.target.toArray() as [number, number, number]
        }
    });
    const historySnapshot = (): string => {
        const { camera, ...definition } = sceneDocument;
        return JSON.stringify(definition);
    };

    function updateButtons(): void {
        element<HTMLButtonElement>("undo").disabled = busy || loadingObjects.size > 0 || historyIndex <= 0;
        element<HTMLButtonElement>("redo").disabled = busy || loadingObjects.size > 0 || historyIndex >= history.length - 1;
        element<HTMLButtonElement>("duplicate").disabled = busy || !selected();
        element<HTMLButtonElement>("delete").disabled = busy || !selected();
        for (const id of ["new-scene", "import-scene", "restore-scene", "apply-version", "export-scene"]) element<HTMLButtonElement>(id).disabled = busy;
        for (const id of ["export-format", "video-duration", "video-fps", "show-grid", "transparent"]) element<HTMLInputElement | HTMLSelectElement>(id).disabled = busy;
        element("add-form").querySelector<HTMLButtonElement>("button[type=submit]")!.disabled = busy;
    }

    function showError(id: string, error?: unknown): void {
        const target = element(id);
        target.textContent = error === undefined ? "" : error instanceof Error ? error.message : String(error);
        target.hidden = error === undefined;
    }

    function saveLocal(): void {
        if (localSaveProtected) return;
        try { localStorage.setItem(storageKey, JSON.stringify(snapshot())); }
        catch { report("Browser storage is full or unavailable. Use Save JSON to keep this scene.", true); }
    }

    function remember(): void {
        const json = historySnapshot();
        if (history[historyIndex] !== json) {
            history = history.slice(0, historyIndex + 1);
            history.push(json);
            if (history.length > 50) history.shift();
            historyIndex = history.length - 1;
        }
        saveLocal();
        updateButtons();
    }

    async function run(label: string, action: () => Promise<void> | void, errorId?: string): Promise<boolean> {
        if (busy || disposed) return false;
        busy = true;
        report(label);
        if (errorId) showError(errorId);
        properties.disabled = true;
        transform.enabled = false;
        updateButtons();
        try {
            await Promise.allSettled([...pendingUpdates]);
            await action();
            return true;
        } catch (error) {
            report(error instanceof Error ? error.message : String(error), true);
            if (errorId) showError(errorId, error);
            console.error(error);
            return false;
        } finally {
            busy = false;
            properties.disabled = false;
            transform.enabled = true;
            updateButtons();
        }
    }

    function updateBounds(): void {
        const current = currentObject();
        selectionBox.visible = !capturing && !!current && current.root.visible;
        if (current) {
            bounds.setFromObject(current.root);
            if (bounds.isEmpty()) selectionBox.visible = false;
        }
        renderer.scene.dirty = true;
    }

    function updateAnimation(): void {
        unsubscribeAnimation?.();
        unsubscribeAnimation = undefined;
        if (sceneDocument.objects.some(object => object.type === "entity" && object.animation && !object.animation.paused)) {
            unsubscribeAnimation = renderer.onFrame(({ delta }) => {
                objects.forEach(object => object.advanceAnimation(delta));
                updateBounds();
            });
        }
    }

    function renameObject(id: string, name: string): void {
        const definition = sceneDocument.objects.find(object => object.id === id), loaded = objects.get(id);
        if (busy || !definition || !loaded) return;
        definition.name = name.trim() || id;
        loaded.definition.name = definition.name;
        loaded.root.name = definition.name;
        if (id === selectedId) element<HTMLInputElement>("object-name").value = definition.name;
        renderList(); remember();
    }

    function setObjectVisible(id: string, visible: boolean): void {
        const definition = sceneDocument.objects.find(object => object.id === id), loaded = objects.get(id);
        if (busy || !definition || !loaded) return;
        definition.visible = visible;
        loaded.definition.visible = visible;
        loaded.root.visible = visible;
        if (id === selectedId) {
            element<HTMLInputElement>("object-visible").checked = visible;
            transform.detach();
            if (visible) transform.attach(loaded.root);
        }
        renderList(); updateBounds(); remember();
    }

    function renderList(): void {
        const rows = new Map(Array.from(objectList.children).map(row => [(row as HTMLElement).dataset.id, row as HTMLElement]));
        for (const row of rows.values()) if (!sceneDocument.objects.some(object => object.id === row.dataset.id)) row.remove();
        for (const [index, definition] of sceneDocument.objects.entries()) {
            let row = rows.get(definition.id);
            if (!row) {
                row = document.createElement("div");
                row.className = "object-row";
                row.dataset.id = definition.id;
                row.setAttribute("role", "listitem");
                const select = document.createElement("button");
                select.className = "object-select";
                select.textContent = definition.type === "skin" ? "player" : definition.type;
                select.addEventListener("click", () => { if (!busy) selectObject(definition.id); });
                const name = document.createElement("input");
                name.className = "object-name";
                name.addEventListener("change", () => renameObject(definition.id, name.value));
                const visibility = document.createElement("button");
                visibility.className = "object-visibility";
                visibility.addEventListener("click", () => setObjectVisible(definition.id, objects.get(definition.id)?.root.visible === false));
                const loading = document.createElement("span");
                loading.className = "object-loading";
                loading.textContent = "Loading…";
                row.append(select, name, visibility, loading);
                objectList.append(row);
            }
            if (objectList.children[index] !== row) objectList.insertBefore(row, objectList.children[index] ?? null);
            row.classList.toggle("hidden-object", definition.visible === false);
            row.setAttribute("aria-selected", String(definition.id === selectedId));
            row.setAttribute("aria-busy", String(loadingObjects.has(definition.id)));
            const name = row.querySelector<HTMLInputElement>(".object-name")!;
            if (document.activeElement !== name) name.value = definition.name || definition.id;
            name.setAttribute("aria-label", `Rename ${definition.name || definition.id}`);
            const select = row.querySelector(".object-select")!;
            select.textContent = definition.type === "skin" ? "player" : definition.type;
            select.setAttribute("aria-label", `Select ${definition.name || definition.id}`);
            const visibility = row.querySelector<HTMLButtonElement>(".object-visibility")!;
            visibility.textContent = definition.visible === false ? "Show" : "Hide";
            visibility.setAttribute("aria-label", `${visibility.textContent} ${definition.name || definition.id}`);
            row.querySelector<HTMLElement>(".object-loading")!.hidden = !loadingObjects.has(definition.id);
        }
        element("object-count").textContent = String(sceneDocument.objects.length);
        if (!sceneDocument.objects.length) {
            const empty = document.createElement("p");
            empty.className = "editor-note";
            empty.textContent = "Add an object to start building your scene.";
            objectList.append(empty);
        }
    }

    function syncTransform(): void {
        const current = currentObject();
        if (!current) return;
        for (const [key, inputs] of vectorInputs) {
            const values = key === "position" ? current.root.position.toArray()
                : key === "rotation" ? [current.root.rotation.x, current.root.rotation.y, current.root.rotation.z].map(value => value * 180 / Math.PI)
                : current.root.scale.toArray();
            inputs.forEach((input, index) => { input.value = String(Math.round(values[index] * 1000) / 1000); });
        }
    }

    function captureTransform(): void {
        const definition = selected(), current = currentObject();
        if (!definition || !current) return;
        definition.position = current.root.position.toArray() as [number, number, number];
        definition.rotation = [current.root.rotation.x, current.root.rotation.y, current.root.rotation.z];
        definition.scale = current.root.scale.toArray() as [number, number, number];
        Object.assign(current.definition, { position: definition.position, rotation: definition.rotation, scale: definition.scale });
        syncTransform();
        updateBounds();
    }

    function renderTransforms(definition: SceneObjectDefinition): void {
        const host = element("transform-properties");
        host.replaceChildren();
        vectorInputs.clear();
        const nameLabel = document.createElement("label");
        nameLabel.className = "editor-field";
        nameLabel.textContent = "Name";
        const name = document.createElement("input");
        name.id = "object-name";
        name.value = definition.name ?? definition.id;
        name.addEventListener("change", () => renameObject(definition.id, name.value));
        nameLabel.append(name);
        const visibility = document.createElement("label");
        visibility.className = "editor-check";
        const visible = document.createElement("input");
        visible.id = "object-visible";
        visible.type = "checkbox";
        visible.checked = definition.visible !== false;
        visible.addEventListener("change", () => setObjectVisible(definition.id, visible.checked));
        visibility.append(visible, " Visible");
        host.append(nameLabel, visibility);
        for (const [key, label] of [["position", "Position · scene units"], ["rotation", "Rotation · degrees"], ["scale", "Scale"]]) {
            const title = document.createElement("p");
            title.className = "vector-label";
            title.textContent = label;
            const row = document.createElement("div");
            row.className = "transform-vector";
            const inputs = ["X", "Y", "Z"].map(axis => {
                const field = document.createElement("label");
                field.className = "editor-field";
                field.textContent = axis;
                const input = document.createElement("input");
                input.type = "number";
                input.step = key === "scale" ? "0.1" : "1";
                input.setAttribute("aria-label", `${label.split(" ·")[0]} ${axis}`);
                field.append(input); row.append(field);
                return input;
            });
            inputs.forEach(input => input.addEventListener("change", () => {
                const values = inputs.map(value => Number(value.value));
                if (inputs.some(value => value.value === "") || values.some(value => !Number.isFinite(value))) {
                    report("Enter three finite numbers for the transform.", true); syncTransform(); return;
                }
                const root = currentObject()!.root;
                if (key === "position") root.position.set(values[0], values[1], values[2]);
                if (key === "scale") root.scale.set(values[0], values[1], values[2]);
                if (key === "rotation") root.rotation.set(...values.map(value => value * Math.PI / 180) as [number, number, number]);
                captureTransform(); remember();
            }));
            vectorInputs.set(key, inputs);
            host.append(title, row);
        }
        syncTransform();
    }

    function preserveInspector(): () => () => void {
        const panel = properties.closest<HTMLElement>(".inspector-panel")!;
        const key = (node: Element): string => {
            const path: string[] = [];
            for (let parent: Element | null = node; parent && parent !== properties; parent = parent.parentElement) {
                const heading = parent.querySelector(":scope > summary, :scope > legend, :scope > h3");
                if (heading) path.unshift(heading.textContent ?? "");
            }
            const parentLabel = node.closest("label");
            const label = parentLabel?.querySelector(":scope > span")?.textContent
                ?? (parentLabel ? Array.from(parentLabel.childNodes).filter(child => child.nodeType === Node.TEXT_NODE).map(child => child.textContent).join("").trim() : undefined);
            return [...path, node.tagName, node.getAttribute("aria-label") ?? label ?? node.textContent ?? ""].join("/");
        };
        const details = new Map(Array.from(properties.querySelectorAll("details")).map(node => [key(node), node.open]));
        const focus = document.activeElement;
        const focusKey = focus && properties.contains(focus) ? key(focus) : undefined;
        const scrollTop = panel.scrollTop;
        return () => {
            let restoredFocus = !focusKey, userScrolled = false;
            const onScroll = () => { userScrolled = true; restoredFocus = true; };
            const restore = () => {
                properties.querySelectorAll("details").forEach(node => {
                    const identity = key(node), open = details.get(identity);
                    if (open !== undefined) { node.open = open; details.delete(identity); }
                });
                if (!restoredFocus && focusKey && (!document.activeElement || document.activeElement === document.body)) {
                    const target = Array.from(properties.querySelectorAll<HTMLElement>("input,select,textarea,button")).find(node => key(node) === focusKey);
                    if (target) { target.focus({ preventScroll: true }); restoredFocus = true; }
                }
                if (!userScrolled) panel.scrollTop = scrollTop;
                if (restoredFocus && !details.size) observer.disconnect();
            };
            const observer = new MutationObserver(restore);
            observer.observe(properties, { childList: true, subtree: true });
            panel.addEventListener("wheel", onScroll, { passive: true });
            panel.addEventListener("pointerdown", onScroll);
            panel.addEventListener("keydown", onScroll);
            restore();
            return () => {
                observer.disconnect(); panel.removeEventListener("wheel", onScroll);
                panel.removeEventListener("pointerdown", onScroll); panel.removeEventListener("keydown", onScroll);
            };
        };
    }

    function selectObject(id?: string, preserve = false): void {
        const restore = preserve && id === selectedId ? preserveInspector() : undefined;
        cleanupInspector?.();
        cleanupInspector = undefined;
        selectedId = id && objects.has(id) ? id : undefined;
        const definition = selected(), current = currentObject();
        properties.hidden = !definition;
        element("selection-empty").hidden = !!definition;
        showError("inspector-error");
        transform.detach();
        if (definition && current) {
            if (current.root.visible) transform.attach(current.root);
            renderTransforms(definition);
            cleanupInspector = renderInspector(element("object-properties"), clone(definition), {
                onChange: replaceObject,
                onError: error => { report(error instanceof Error ? error.message : String(error), true); showError("inspector-error", error); },
                getAnimationTime: () => { const object = currentObject()?.object; return object && isEntityObject(object) ? object.animationTime : 0; },
                onSkinPoseChange: applySkinPose,
                onAnimationChange: applyAnimation
            });
        }
        if (restore) {
            const cleanup = cleanupInspector, stopRestoring = restore();
            cleanupInspector = () => { cleanup?.(); stopRestoring(); };
        }
        renderList(); updateButtons(); updateBounds();
    }

    function applySkinPose(pose: SceneSkinDefinition["pose"]): void {
        const definition = selected(), loaded = currentObject();
        if (busy || disposed || definition?.type !== "skin" || loaded?.definition.type !== "skin") return;
        if (pose && Object.keys(pose).length) {
            definition.pose = clone(pose);
            loaded.definition.pose = definition.pose;
        } else {
            delete definition.pose;
            delete loaded.definition.pose;
        }
        for (const part of ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg", "cape"] as const) {
            loaded.object.getGroupByName(part)?.rotation.set(...(definition.pose?.[part] ?? [part === "cape" ? Math.PI / 30 : 0, 0, 0]), "XYZ");
        }
        loaded.object.notifyDirty();
        updateBounds();
        report("Skin pose updated."); remember();
    }

    function trackUpdate(update: Promise<void>): Promise<void> {
        pendingUpdates.add(update);
        void update.then(() => pendingUpdates.delete(update), () => pendingUpdates.delete(update));
        return update;
    }

    function applyAnimation(animation: SceneEntityDefinition["animation"]): Promise<void> {
        const initial = selected();
        if (busy || disposed || initial?.type !== "entity") return Promise.resolve();
        const token = Symbol();
        animationRequests.set(initial.id, token);
        return trackUpdate((async () => {
            const clips = animation ? await Entities.getAnimations(AssetKey.parse("entities", initial.asset)) : undefined;
            const definition = sceneDocument.objects.find(object => object.id === initial.id), loaded = objects.get(initial.id);
            if (disposed || animationRequests.get(initial.id) !== token || definition?.type !== "entity"
                || definition.asset !== initial.asset || loaded?.definition.type !== "entity" || !isEntityObject(loaded.object)) return;
            if (animation) {
                const clip = clips?.[animation.name];
                if (!clip) throw new Error(`Entity ${definition.asset} has no animation "${animation.name}"`);
                loaded.object.playAnimation(clip, animation);
                definition.animation = clone(animation);
                loaded.definition.animation = definition.animation;
            } else {
                loaded.object.stopAnimation();
                delete definition.animation;
                delete loaded.definition.animation;
            }
            showError("inspector-error");
            updateAnimation(); updateBounds();
            report("Animation updated."); remember();
        })());
    }

    function replaceObject(next: SceneObjectDefinition, refresh = false): Promise<void> {
        const before = sceneDocument.objects.find(object => object.id === next.id);
        if (busy || disposed || !before) return Promise.resolve();
        const structure = (definition: SceneObjectDefinition) => definition.type === "entity"
            ? [definition.asset, definition.layers, definition.when]
            : definition.type === "skin" ? [!!definition.cape] : "asset" in definition ? [definition.asset] : [];
        refresh ||= !equalJson(structure(before), structure(next));
        const token = Symbol();
        loadingObjects.set(next.id, token);
        showError("inspector-error");
        renderList(); updateButtons();
        const previous = clone(before);
        const update = (async () => {
            let staged: LoadedSceneObject | undefined;
            try {
                staged = await SceneDocumentLoader.loadObject(renderer.scene, next, new Group());
                const live = sceneDocument.objects.find(object => object.id === next.id);
                const clips = next.type === "entity" && live?.type === "entity" && previous.type === "entity"
                    && live.animation && !equalJson(live.animation, previous.animation)
                    ? await Entities.getAnimations(AssetKey.parse("entities", next.asset)) : undefined;
                const current = sceneDocument.objects.find(object => object.id === next.id), old = objects.get(next.id);
                if (disposed || loadingObjects.get(next.id) !== token || !current || !old) { staged.dispose(); return; }
                next = { ...next, name: current.name, position: current.position, rotation: current.rotation,
                    scale: current.scale, visible: current.visible };
                if (next.type === "skin" && current.type === "skin" && previous.type === "skin" && !equalJson(current.pose, previous.pose)) {
                    next.pose = current.pose;
                    for (const part of ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg", "cape"] as const) {
                        staged.object.getGroupByName(part)?.rotation.set(...(next.pose?.[part] ?? [part === "cape" ? Math.PI / 30 : 0, 0, 0]), "XYZ");
                    }
                }
                if (next.type === "entity" && current.type === "entity" && previous.type === "entity" && !equalJson(current.animation, previous.animation)) {
                    next.animation = current.animation;
                    if (isEntityObject(staged.object)) {
                        if (next.animation) {
                            const clip = clips?.[next.animation.name];
                            if (!clip) throw new Error(`Entity ${next.asset} has no animation "${next.animation.name}"`);
                            staged.object.playAnimation(clip, next.animation);
                        } else staged.object.stopAnimation();
                    }
                }
                Object.assign(staged.definition, next);
                staged.root.name = next.name ?? next.id;
                staged.root.position.fromArray(next.position ?? [0, 0, 0]);
                staged.root.rotation.set(...(next.rotation ?? [0, 0, 0]));
                staged.root.scale.fromArray(next.scale ?? [1, 1, 1]);
                staged.root.visible = next.visible ?? true;
                content.add(staged.root);
                objects.set(next.id, staged);
                sceneDocument.objects = sceneDocument.objects.map(object => object.id === next.id ? clone(next) : object);
                old.dispose();
                if (selectedId === next.id) {
                    if (refresh) selectObject(next.id, true);
                    else {
                        transform.detach();
                        if (staged.root.visible) transform.attach(staged.root);
                        syncTransform(); updateBounds();
                    }
                }
                updateAnimation();
                report("Object updated."); remember();
            } catch (error) {
                staged?.dispose();
                if (loadingObjects.get(next.id) === token && objects.has(next.id) && !disposed) throw error;
            } finally {
                if (loadingObjects.get(next.id) === token) loadingObjects.delete(next.id);
                if (!disposed) { renderList(); updateButtons(); }
            }
        })();
        return trackUpdate(update);
    }

    async function appendObjects(definitions: SceneObjectDefinition[]): Promise<void> {
        const incoming = SceneDocumentLoader.parse({ ...sceneDocument, objects: definitions });
        const staged = await SceneDocumentLoader.load(renderer.scene, incoming, new Group());
        if (disposed) { staged.dispose(); return; }
        for (const object of staged.objects) {
            content.add(object.root);
            objects.set(object.definition.id, object);
        }
        staged.root.removeFromParent();
        sceneDocument.objects.push(...clone(incoming.objects));
        selectObject(incoming.objects[incoming.objects.length - 1]?.id);
        updateAnimation();
        report(`Added ${definitions.length === 1 ? "object" : `${definitions.length} objects`}.`); remember();
    }

    async function replaceDocument(input: unknown): Promise<void> {
        const next = SceneDocumentLoader.parse(input);
        const oldVersion = AssetLoader.version;
        const versionChanged = next.minecraftVersion !== undefined && next.minecraftVersion !== oldVersion;
        let staged;
        if (versionChanged) await validateMinecraftVersion(next.minecraftVersion!);
        try {
            if (versionChanged) AssetLoader.setVersion(next.minecraftVersion!);
            staged = await SceneDocumentLoader.load(renderer.scene, next, new Group());
        } catch (error) {
            if (versionChanged) AssetLoader.setVersion(oldVersion);
            throw error;
        }
        if (disposed) { staged.dispose(); return; }
        transform.detach();
        objects.forEach(object => object.dispose());
        objects = new Map();
        for (const object of staged.objects) {
            content.add(object.root);
            objects.set(object.definition.id, object);
        }
        staged.root.removeFromParent();
        sceneDocument = clone(next);
        sceneDocument.minecraftVersion = AssetLoader.version;
        element<HTMLInputElement>("minecraft-version").value = AssetLoader.version;
        if (next.camera) {
            renderer.camera.position.fromArray(next.camera.position);
            renderer.controls!.target.fromArray(next.camera.target);
            renderer.controls!.update();
        }
        selectObject(next.objects[0]?.id); updateAnimation();
        void refreshCatalog();
    }

    function fit(): void {
        const box = new Box3().setFromObject(currentObject()?.root ?? content);
        if (box.isEmpty()) return;
        const center = box.getCenter(new Vector3());
        const size = Math.max(16, box.getSize(new Vector3()).length());
        const direction = renderer.camera.position.clone().sub(renderer.controls!.target).normalize();
        if (!direction.lengthSq()) direction.set(1, 0.7, 1).normalize();
        renderer.camera.position.copy(center).addScaledVector(direction, size * 1.6);
        renderer.controls!.target.copy(center);
        renderer.controls!.update();
        renderer.scene.dirty = true;
    }

    const defaults: Record<string, string> = {
        block: "minecraft:stone", item: "minecraft:diamond_sword", entity: "minecraft:creeper",
        model: "minecraft:block/stone", skin: "", gui: "minecraft:gui/container/generic_54"
    };
    async function refreshCatalog(): Promise<void> {
        const generation = ++catalogGeneration;
        const type = element<HTMLSelectElement>("add-type").value;
        const list = element("asset-list");
        const hint = element("asset-hint");
        hint.textContent = getObjectListHint(type as SceneObjectDefinition["type"]);
        list.replaceChildren();
        try {
            const items = await getObjectList(type);
            if (generation !== catalogGeneration || disposed) return;
            const options = items.map(value => { const option = document.createElement("option"); option.value = value; return option; });
            list.replaceChildren(...options);
        } catch {
            if (generation === catalogGeneration) hint.textContent = "Suggestions could not load. You can still enter an asset ID.";
        }
    }

    element("add-type").addEventListener("change", () => {
        const type = element<HTMLSelectElement>("add-type").value;
        const input = element<HTMLInputElement>("add-asset");
        input.value = defaults[type];
        input.placeholder = type === "skin" ? "Player name, UUID, or PNG URL (optional)" : type === "gui" ? "GUI texture ID, or leave empty for text" : "minecraft:asset";
        showError("add-error");
        void refreshCatalog();
    });
    element("add-form").addEventListener("submit", event => {
        event.preventDefault();
        const type = element<HTMLSelectElement>("add-type").value;
        const asset = element<HTMLInputElement>("add-asset").value.trim();
        void run("Adding object…", async () => {
            const selectedRoot = currentObject()?.root;
            const position = selectedRoot ? selectedRoot.position.clone() : renderer.controls!.target.clone();
            if (selectedRoot) position.x += Math.max(16, new Box3().setFromObject(selectedRoot).getSize(new Vector3()).x + 4);
            const base = { id: crypto.randomUUID(), name: type === "skin" ? "Player" : asset.split(":").pop() || "GUI text", position: position.toArray() as [number, number, number] };
            let definition: SceneObjectDefinition;
            if (type === "skin") definition = { ...base, type, ...(asset ? { skin: asset } : {}) };
            else if (type === "gui") definition = { ...base, type, layers: [asset ? { texture: asset, position: [0, 0] } : { text: "Hello, MineRender", position: [0, 0] }] };
            else definition = { ...base, type, asset } as SceneObjectDefinition;
            await appendObjects([definition]);
        }, "add-error");
    });

    element("duplicate").addEventListener("click", () => { void run("Duplicating object…", async () => {
        const definition = selected();
        if (!definition) return;
        const copy = clone(definition);
        copy.id = crypto.randomUUID();
        copy.name = `${definition.name ?? definition.id} copy`;
        copy.position = [...(copy.position ?? [0, 0, 0])];
        copy.position[0] += 16;
        await appendObjects([copy]);
    }); });
    function removeSelected(): void {
        if (busy || !selectedId) return;
        const id = selectedId;
        transform.detach();
        objects.get(id)?.dispose(); objects.delete(id);
        loadingObjects.delete(id); animationRequests.delete(id);
        sceneDocument.objects = sceneDocument.objects.filter(object => object.id !== id);
        selectObject(); updateAnimation(); report("Object removed. Use Undo to restore it."); remember();
    }
    element("delete").addEventListener("click", removeSelected);

    function applyHistoryTransforms(next: SceneDocument): boolean {
        const { objects: previousObjects, camera: previousCamera, ...previousSettings } = sceneDocument;
        const { objects: nextObjects, camera: nextCamera, ...nextSettings } = next;
        const content = ({ position, rotation, scale, name, visible, ...definition }: SceneObjectDefinition) => definition;
        if (!equalJson(previousSettings, nextSettings) || previousObjects.length !== nextObjects.length
            || !nextObjects.every((definition, index) => definition.id === previousObjects[index].id
                && objects.has(definition.id) && equalJson(content(definition), content(previousObjects[index])))) return false;
        for (const definition of nextObjects) {
            const loaded = objects.get(definition.id)!;
            loaded.root.position.fromArray(definition.position ?? [0, 0, 0]);
            loaded.root.rotation.set(...(definition.rotation ?? [0, 0, 0]));
            loaded.root.scale.fromArray(definition.scale ?? [1, 1, 1]);
            loaded.root.name = definition.name ?? definition.id;
            loaded.root.visible = definition.visible ?? true;
            Object.assign(loaded.definition, {
                position: definition.position, rotation: definition.rotation, scale: definition.scale,
                name: definition.name, visible: definition.visible
            });
        }
        sceneDocument = next;
        selectObject(selectedId);
        return true;
    }

    async function travelHistory(offset: number): Promise<void> {
        if (loadingObjects.size) return;
        await run(offset < 0 ? "Undoing…" : "Redoing…", async () => {
            const index = historyIndex + offset;
            if (index < 0 || index >= history.length) return;
            const next = SceneDocumentLoader.parse(history[index]);
            if (!applyHistoryTransforms(next)) {
                const selection = selectedId;
                await replaceDocument(next);
                selectObject(selection);
            }
            historyIndex = index;
            saveLocal();
            report(offset < 0 ? "Undone." : "Redone.");
        });
    }
    element("undo").addEventListener("click", () => { void travelHistory(-1); });
    element("redo").addEventListener("click", () => { void travelHistory(1); });
    element("fit-scene").addEventListener("click", fit);
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-mode]")) {
        button.addEventListener("click", () => setMode(button.dataset.mode as "translate" | "rotate" | "scale"));
    }
    function setMode(mode: "translate" | "rotate" | "scale"): void {
        transform.setMode(mode);
        document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.mode === mode)));
    }
    element("transform-space").addEventListener("change", event => transform.setSpace((event.target as HTMLSelectElement).value as "world" | "local"));
    element("snap").addEventListener("change", event => {
        const enabled = (event.target as HTMLInputElement).checked;
        transform.setTranslationSnap(enabled ? 16 : null);
        transform.setRotationSnap(enabled ? Math.PI / 12 : null);
        transform.setScaleSnap(enabled ? 0.25 : null);
    });
    transform.addEventListener("dragging-changed", event => { renderer.controls!.enabled = !event.value; });
    transform.addEventListener("objectChange", captureTransform);
    transform.addEventListener("mouseUp", () => { captureTransform(); remember(); });

    const raycaster = new Raycaster();
    let pointerStart: { x: number; y: number; transforming: boolean } | undefined;
    const canvas = renderer.renderer.domElement;
    canvas.addEventListener("pointerdown", event => {
        if (event.button === 0) pointerStart = { x: event.clientX, y: event.clientY, transforming: transform.dragging || transform.axis !== null };
    });
    canvas.addEventListener("pointerup", event => {
        const start = pointerStart; pointerStart = undefined;
        if (busy || !start || start.transforming || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 4) return;
        const rect = canvas.getBoundingClientRect();
        raycaster.setFromCamera(new Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), renderer.camera);
        const candidates = [...objects.values()].filter(object => object.root.visible).map(object => object.root);
        const hit = raycaster.intersectObjects(candidates, true).find(hit => {
            for (let node = hit.object; node && node !== content; node = node.parent!) if (!node.visible) return false;
            return true;
        });
        let id: string | undefined;
        if (hit) for (const [candidate, object] of objects) {
            for (let node = hit.object; node; node = node.parent!) if (node === object.root) id = candidate;
        }
        selectObject(id);
    });

    function onKey(event: KeyboardEvent): void {
        if (busy || element<HTMLDialogElement>("code-dialog").open || (event.target as HTMLElement).closest("input,textarea,select,[contenteditable]")) return;
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
            event.preventDefault(); void travelHistory(event.shiftKey ? 1 : -1); return;
        }
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        const mode = ({ w: "translate", e: "rotate", r: "scale" } as const)[event.key.toLowerCase()];
        if (mode) setMode(mode);
        if (event.key.toLowerCase() === "f") fit();
        if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeSelected(); }
        if (event.key === "Escape") selectObject();
    }
    window.addEventListener("keydown", onKey);

    element("new-scene").addEventListener("click", () => { void run("Creating empty scene…", async () => {
        await replaceDocument(emptyDocument()); report("Empty scene ready. Use Undo to restore the previous scene."); remember();
    }); });
    element("save-scene").addEventListener("click", () => { download(snapshot(), "scene.json"); report("Scene JSON downloaded."); });
    element("import-scene").addEventListener("click", () => element<HTMLInputElement>("file-input").click());
    element("file-input").addEventListener("change", event => {
        const input = event.target as HTMLInputElement;
        const file = input.files?.[0]; input.value = "";
        if (!file) return;
        void run(`Importing ${file.name}…`, async () => {
            if (/\.(nbt|schematic)$/i.test(file.name)) await appendObjects(await importStructure(file));
            else {
                if (file.size > 20 * 1024 * 1024) throw new Error("Scene JSON must be smaller than 20 MB.");
                await replaceDocument(await file.text());
                report("Scene imported. Use Undo to restore the previous scene."); remember();
            }
        });
    });
    element("restore-scene").addEventListener("click", () => { void run("Restoring local save…", async () => {
        const saved = localStorage.getItem(storageKey);
        if (!saved) throw new Error("No saved scene in this browser yet.");
        await replaceDocument(saved);
        localSaveProtected = false;
        showError("local-save-error");
        report("Local save restored."); remember();
    }, "local-save-error"); });
    element("apply-version").addEventListener("click", () => { void run("Reloading scene assets…", async () => {
        const next = snapshot(); next.minecraftVersion = element<HTMLInputElement>("minecraft-version").value.trim();
        if (!next.minecraftVersion) throw new Error("Enter a Minecraft version, such as 1.21.11.");
        if (next.minecraftVersion === AssetLoader.version) await validateMinecraftVersion(next.minecraftVersion);
        await replaceDocument(next); report(`Loaded Minecraft ${next.minecraftVersion} assets.`); remember();
    }, "version-error"); });
    element("show-grid").addEventListener("change", event => { grid.visible = (event.target as HTMLInputElement).checked; renderer.scene.dirty = true; });
    element("transparent").addEventListener("change", event => {
        renderer.scene.background = (event.target as HTMLInputElement).checked ? null : new Color("#19212d"); renderer.scene.dirty = true;
    });

    const videoDuration = element<HTMLInputElement>("video-duration");
    const videoFps = element<HTMLInputElement>("video-fps");
    const cancelRecording = element<HTMLButtonElement>("cancel-recording");
    element("export-format").addEventListener("change", event => {
        element("video-settings").hidden = (event.target as HTMLSelectElement).value !== "video";
    });
    cancelRecording.addEventListener("click", () => recording?.abort());
    element("export-scene").addEventListener("click", () => { void run("Exporting scene…", async () => {
        const format = element<HTMLSelectElement>("export-format").value;
        if (format === "png" || format === "video") {
            const duration = videoDuration.valueAsNumber, fps = videoFps.valueAsNumber;
            if (format === "video" && (!Number.isFinite(duration) || duration < 0.1 || duration > 120
                || !Number.isInteger(fps) || fps < 1 || fps > 60)) {
                throw new Error("Use a duration of 0.1–120 seconds and a whole-number FPS of 1–60.");
            }
            const visibility = [grid.visible, selectionBox.visible, transformHelper.visible];
            capturing = true;
            grid.visible = selectionBox.visible = transformHelper.visible = false;
            try {
                if (format === "png") download(renderer.toImage(), "scene.png", "image/png");
                else {
                    recording = new AbortController();
                    cancelRecording.hidden = false;
                    report(`Recording ${duration} seconds… Keep this tab visible.`);
                    const video = await renderer.toVideo({ duration, fps, signal: recording.signal });
                    download(video, `scene.${video.type.startsWith("video/mp4") ? "mp4" : "webm"}`);
                }
            } catch (error) {
                if (error instanceof Error && error.name === "AbortError") { report("Recording cancelled."); return; }
                throw error;
            } finally {
                recording = undefined;
                capturing = false;
                cancelRecording.hidden = true;
                [grid.visible, selectionBox.visible, transformHelper.visible] = visibility;
                renderer.scene.dirty = true;
            }
        } else if (format === "obj") download(SceneExporter.toObj(content), "scene.obj", "text/plain");
        else if (format === "ply") download(SceneExporter.toPLY(content), "scene.ply", "application/octet-stream");
        else download(await SceneExporter.toGLTF(content, { binary: format === "glb" }), `scene.${format}`, format === "glb" ? "model/gltf-binary" : "model/gltf+json");
        report("Export downloaded.");
    }); });
    const codeDialog = element<HTMLDialogElement>("code-dialog");
    element("show-code").addEventListener("click", () => {
        element<HTMLTextAreaElement>("code-output").value = `import { AssetLoader, Renderer, SceneDocumentLoader } from "minerender";

const response = await fetch("./scene.json");
if (!response.ok) throw new Error("Could not fetch scene.json");
const definition = SceneDocumentLoader.parse(await response.json());
if (definition.minecraftVersion) AssetLoader.setVersion(definition.minecraftVersion);

const renderer = new Renderer({
    controls: { enabled: true },
    ...(definition.camera ? { camera: {
        position: definition.camera.position,
        lookingAt: definition.camera.target
    } } : {})
});
renderer.appendTo(document.body);
const scene = await SceneDocumentLoader.load(renderer.scene, definition);
const unsubscribe = renderer.onFrame(({ delta }) => scene.advanceAnimations(delta));
renderer.start();

// Release the scene when its view closes.
function dispose() {
    unsubscribe();
    scene.dispose();
    renderer.dispose();
}
`;
        codeDialog.showModal();
    });
    element("close-code").addEventListener("click", () => codeDialog.close());
    element("copy-code").addEventListener("click", () => {
        void navigator.clipboard.writeText(element<HTMLTextAreaElement>("code-output").value).then(() => report("Code copied."), () => {
            element<HTMLTextAreaElement>("code-output").select(); report("Select the code and copy it with Ctrl/Cmd+C.");
        });
    });

    function dispose(): void {
        if (disposed) return;
        disposed = true;
        cleanupInspector?.(); unsubscribeAnimation?.(); observer.disconnect();
        window.removeEventListener("keydown", onKey);
        objects.forEach(object => object.dispose());
        transform.dispose();
        grid.geometry.dispose();
        (Array.isArray(grid.material) ? grid.material : [grid.material]).forEach(material => material.dispose());
        selectionBox.geometry.dispose();
        (Array.isArray(selectionBox.material) ? selectionBox.material : [selectionBox.material]).forEach(material => material.dispose());
        renderer.dispose();
    }
    window.addEventListener("pagehide", event => { if (!event.persisted) dispose(); }, { once: true });
    document.addEventListener("visibilitychange", () => { if (!disposed) document.hidden ? renderer.stop() : renderer.start(); });
    selectObject();
    localSaveProtected = true;
    const restored = await run("Restoring local save…", async () => {
        const saved = localStorage.getItem(storageKey);
        if (saved) {
            await replaceDocument(saved);
            report("Local save restored.");
        } else report("Add objects to build a scene, or import a saved JSON, .nbt, or .schematic file.");
        localSaveProtected = false;
    }, "local-save-error");
    if (!restored) showError("local-save-error", "The saved scene could not load. It is preserved. Retry Restore, or use Save JSON to keep new edits.");
    history = [historySnapshot()]; historyIndex = 0;
    updateButtons();
    void refreshCatalog();
}

void start().catch(error => {
    report(`Could not start the editor: ${error instanceof Error ? error.message : String(error)}`, true);
    console.error(error);
});
