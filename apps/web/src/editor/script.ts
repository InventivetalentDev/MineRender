import {
    AssetLoader, Renderer, SceneDocumentLoader, SceneExporter, isEntityObject,
    type LoadedSceneObject, type SceneDocument, type SceneObjectDefinition, type SceneSkinDefinition
} from "minerender";
import { Box3, Box3Helper, Color, GridHelper, Group, Raycaster, Vector2, Vector3 } from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { renderInspector } from "./inspector";
import { getObjectList } from "./catalog";
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

function download(data: string | ArrayBuffer | object, filename: string, mime = "application/json"): void {
    const dataUrl = typeof data === "string" && data.startsWith("data:");
    const url = dataUrl ? data : URL.createObjectURL(new Blob([
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
    let disposed = false;
    let history: string[] = [];
    let historyIndex = -1;
    let catalogGeneration = 0;
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
        element<HTMLButtonElement>("undo").disabled = busy || historyIndex <= 0;
        element<HTMLButtonElement>("redo").disabled = busy || historyIndex >= history.length - 1;
        element<HTMLButtonElement>("duplicate").disabled = busy || !selected();
        element<HTMLButtonElement>("delete").disabled = busy || !selected();
    }

    function remember(): void {
        const json = historySnapshot();
        if (history[historyIndex] !== json) {
            history = history.slice(0, historyIndex + 1);
            history.push(json);
            if (history.length > 50) history.shift();
            historyIndex = history.length - 1;
        }
        try { localStorage.setItem(storageKey, JSON.stringify(snapshot())); }
        catch { report("Browser storage is full or unavailable. Use Save JSON to keep this scene.", true); }
        updateButtons();
    }

    async function run(label: string, action: () => Promise<void> | void): Promise<boolean> {
        if (busy || disposed) return false;
        busy = true;
        report(label);
        document.body.classList.add("loading");
        const controls = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("button, input, select, textarea"));
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        properties.disabled = true;
        transform.enabled = false;
        try {
            await action();
            return true;
        } catch (error) {
            report(error instanceof Error ? error.message : String(error), true);
            console.error(error);
            return false;
        } finally {
            busy = false;
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
            properties.disabled = false;
            transform.enabled = true;
            document.body.classList.remove("loading");
            updateButtons();
        }
    }

    function updateBounds(): void {
        const current = currentObject();
        selectionBox.visible = !!current && current.root.visible;
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

    function renderList(): void {
        objectList.replaceChildren();
        for (const definition of sceneDocument.objects) {
            const button = document.createElement("button");
            button.className = "object-row";
            button.classList.toggle("hidden-object", definition.visible === false);
            button.setAttribute("aria-pressed", String(definition.id === selectedId));
            button.setAttribute("role", "listitem");
            const type = document.createElement("span");
            type.className = "object-type";
            type.textContent = definition.type === "skin" ? "player" : definition.type;
            const name = document.createElement("span");
            name.className = "object-name";
            name.textContent = definition.name || definition.id;
            button.append(type, name);
            button.addEventListener("click", () => { if (!busy) selectObject(definition.id); });
            objectList.append(button);
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
        name.value = definition.name ?? definition.id;
        name.addEventListener("change", () => {
            definition.name = name.value.trim() || definition.id;
            currentObject()!.root.name = definition.name;
            renderList(); remember();
        });
        nameLabel.append(name);
        const visibility = document.createElement("label");
        visibility.className = "editor-check";
        const visible = document.createElement("input");
        visible.type = "checkbox";
        visible.checked = definition.visible !== false;
        visible.addEventListener("change", () => {
            definition.visible = visible.checked;
            currentObject()!.root.visible = visible.checked;
            selectObject(definition.id); remember();
        });
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

    function selectObject(id?: string): void {
        cleanupInspector?.();
        cleanupInspector = undefined;
        selectedId = id && objects.has(id) ? id : undefined;
        const definition = selected(), current = currentObject();
        properties.hidden = !definition;
        element("selection-empty").hidden = !!definition;
        transform.detach();
        if (definition && current) {
            if (current.root.visible) transform.attach(current.root);
            renderTransforms(definition);
            cleanupInspector = renderInspector(element("object-properties"), clone(definition), {
                onChange: next => { void replaceObject(next); },
                onError: error => report(error instanceof Error ? error.message : String(error), true),
                getAnimationTime: () => isEntityObject(current.object) ? current.object.animationTime : 0,
                onSkinPoseChange: applySkinPose
            });
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

    async function replaceObject(next: SceneObjectDefinition): Promise<void> {
        const current = sceneDocument.objects.find(object => object.id === next.id);
        if (!current) return;
        next = { ...next, name: current.name, position: current.position, rotation: current.rotation,
            scale: current.scale, visible: current.visible };
        const updated = await run("Updating object…", async () => {
            const old = objects.get(next.id);
            if (!old) return;
            const staged = await SceneDocumentLoader.loadObject(renderer.scene, next, new Group());
            if (disposed) { staged.dispose(); return; }
            content.add(staged.root);
            objects.set(next.id, staged);
            sceneDocument.objects = sceneDocument.objects.map(object => object.id === next.id ? clone(next) : object);
            old.dispose();
            selectObject(next.id); updateAnimation();
            report("Object updated."); remember();
        });
        if (!updated && !disposed) selectObject(selectedId);
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
        list.replaceChildren();
        try {
            const items = await getObjectList(type);
            if (generation !== catalogGeneration || disposed) return;
            const options = items.map(value => { const option = document.createElement("option"); option.value = value; return option; });
            list.replaceChildren(...options);
        } catch { /* Asset IDs can still be entered when a directory index is unavailable. */ }
    }

    element("add-type").addEventListener("change", () => {
        const type = element<HTMLSelectElement>("add-type").value;
        const input = element<HTMLInputElement>("add-asset");
        input.value = defaults[type];
        input.placeholder = type === "skin" ? "Skin texture URL (optional)" : "minecraft:asset";
        void refreshCatalog();
    });
    element("add-form").addEventListener("submit", event => {
        event.preventDefault();
        void run("Adding object…", async () => {
            const type = element<HTMLSelectElement>("add-type").value;
            const asset = element<HTMLInputElement>("add-asset").value.trim();
            const base = { id: crypto.randomUUID(), name: `${type === "skin" ? "Player" : asset.split(":").pop()}`, position: [0, 0, 0] as [number, number, number] };
            let definition: SceneObjectDefinition;
            if (type === "skin") definition = { ...base, type, ...(asset ? { skin: asset } : {}) };
            else if (type === "gui") definition = { ...base, type, layers: [{ texture: asset, position: [0, 0] }] };
            else definition = { ...base, type, asset } as SceneObjectDefinition;
            await appendObjects([definition]);
        });
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
        const index = historyIndex + offset;
        if (index < 0 || index >= history.length) return;
        await run(offset < 0 ? "Undoing…" : "Redoing…", async () => {
            const next = SceneDocumentLoader.parse(history[index]);
            if (!applyHistoryTransforms(next)) {
                const selection = selectedId;
                await replaceDocument(next);
                selectObject(selection);
            }
            historyIndex = index;
            try { localStorage.setItem(storageKey, JSON.stringify(snapshot())); } catch { /* Download remains available without browser storage. */ }
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
        await replaceDocument(saved); report("Local save restored."); remember();
    }); });
    element("apply-version").addEventListener("click", () => { void run("Reloading scene assets…", async () => {
        const next = snapshot(); next.minecraftVersion = element<HTMLInputElement>("minecraft-version").value.trim();
        if (!next.minecraftVersion) throw new Error("Enter a Minecraft version, such as 1.21.11.");
        await replaceDocument(next); report(`Loaded Minecraft ${next.minecraftVersion} assets.`); remember();
    }); });
    element("show-grid").addEventListener("change", event => { grid.visible = (event.target as HTMLInputElement).checked; renderer.scene.dirty = true; });
    element("transparent").addEventListener("change", event => {
        renderer.scene.background = (event.target as HTMLInputElement).checked ? null : new Color("#19212d"); renderer.scene.dirty = true;
    });

    element("export-scene").addEventListener("click", () => { void run("Exporting scene…", async () => {
        const format = element<HTMLSelectElement>("export-format").value;
        if (format === "png") {
            const visibility = [grid.visible, selectionBox.visible, transformHelper.visible];
            grid.visible = selectionBox.visible = transformHelper.visible = false;
            try { download(renderer.toImage(), "scene.png", "image/png"); }
            finally { [grid.visible, selectionBox.visible, transformHelper.visible] = visibility; renderer.scene.dirty = true; }
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
    history = [historySnapshot()]; historyIndex = 0;
    report("Add objects to build a scene, or import a saved JSON, .nbt, or .schematic file.");
    void refreshCatalog();
}

void start().catch(error => {
    report(`Could not start the editor: ${error instanceof Error ? error.message : String(error)}`, true);
    console.error(error);
});
