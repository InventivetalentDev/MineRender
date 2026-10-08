import { AssetKey, Entities, EntityObject, Renderer } from "minerender";
import type { EntityAnimation, EntityModel, EntityModelPass } from "minerender";
import { Color } from "three";
import type { BufferGeometry, Mesh, Object3D } from "three";
import { Playground } from "../../playground/Playground";

interface EntityState {
    entity: string;
    /** `auto` draws `main` plus the dataset passes enabled by `when`; `manual` draws exactly `layers`. */
    selection: "auto" | "manual";
    layers: string[];
    when: string[];
    tints: Record<string, string>;
    /** Texture asset IDs per draw, keyed like `EntityModel.layers`. */
    textures: Record<string, string>;
    flip: "dataset" | "flip" | "raw";
    wireframe: boolean;
    hiddenParts: string[];
    /** Clip names playing together, at most one per geometry layer. */
    animations: string[];
    playing: boolean;
    time: number;
    speed: number;
    loop: boolean;
}

const defaults: EntityState = {
    entity: "bat", selection: "auto", layers: ["main"], when: [], tints: {}, textures: {}, flip: "dataset",
    wireframe: false, hiddenParts: [], animations: [], playing: false, time: 0, speed: 1, loop: true
};
let activeEntity: EntityObject | undefined;
let activeCurrent: (() => boolean) | undefined;
let activeParts: { key: string, object: Object3D }[] = [];
let resetPose: () => void = () => {};
let playback: ReturnType<typeof createPlayback> | undefined;

const app = new Playground<EntityState>({
    title: "Entities",
    defaults,
    renderer: { camera: { near: 1, far: 2000, position: [50, 35, 50] } },
    presets: {
        bat: { label: "Bat (flying animation)", state: { animations: ["flying"], playing: true } },
        charged: { label: "Charged creeper", state: { entity: "creeper", when: ["powered"] } },
        sheep: { label: "Orange sheep", state: { entity: "sheep", when: ["not_sheared", "dyed"], tints: { wool_color: "#f9801d" } } },
        breeze: { label: "Breeze (wind layer)", state: { entity: "breeze" } }
    },
    async load(ctx, state) {
        validateState(state);
        const key = AssetKey.parse("entities", state.entity.trim());
        const [layers, passes, animations, names] = await Promise.all([
            Entities.getLayerList(key), Entities.getPassList(key), Entities.getAnimations(key), Entities.getEntityList().catch(() => [])
        ]);
        if (!ctx.isCurrent()) return;
        if (!layers.length) throw new Error(`Entity model not found: ${state.entity}`);
        if (state.selection === "manual" && !state.layers.length) throw new Error("Select at least one layer.");
        const textures: Record<string, AssetKey> = {};
        for (const [draw, path] of Object.entries(state.textures)) {
            if (path.trim()) textures[draw] = AssetKey.parse("textures", path.trim().replace(/^([^:]+:)?textures\//, "$1"));
        }
        const model = await Entities.getEntity(key, undefined, {
            ...(state.selection === "manual" ? { layers: state.layers } : { when: state.when }), textures
        });
        if (!ctx.isCurrent()) return;
        if (!model) throw new Error(`Entity model not found: ${state.entity}`);
        const object = new EntityObject(model, {
            tints: state.tints, wireframe: state.wireframe,
            flip: state.flip === "dataset" ? undefined : state.flip === "flip"
        });
        object.scene = ctx.renderer.scene;
        let controller: ReturnType<typeof createPlayback> | undefined;
        ctx.onCleanup(() => {
            controller?.dispose();
            const geometries = new Set<BufferGeometry>();
            object.traverse(part => {
                const geometry = (part as Mesh).geometry;
                if (geometry) geometries.add(geometry);
            });
            object.dispose();
            geometries.forEach(geometry => geometry.dispose());
        });
        await object.init();
        const parts = getParts(object);
        const poses = parts.map(({ object: part }) => ({
            part, position: part.position.clone(), rotation: part.rotation.clone(), scale: part.scale.clone()
        }));
        for (const part of parts) part.object.visible = !state.hiddenParts.includes(part.key);
        ctx.renderer.scene.add(object);
        const drawnLayers = Object.keys(model.layers ?? { main: model }).map(name => name.split("#")[0]);
        const sync = () => {
            activeEntity = object;
            activeCurrent = ctx.isCurrent;
            activeParts = parts;
            window["entity"] = object;
            playback = controller;
            resetPose = () => {
                controller?.stop();
                for (const { part, position, rotation, scale } of poses) {
                    part.position.copy(position);
                    part.rotation.copy(rotation);
                    part.scale.copy(scale);
                }
                object.notifyDirty();
            };
            buildControls(app.state, layers, passes, model, animations ?? {});
            document.getElementById("entity-suggestions")!.replaceChildren(...names.map(name => new Option(name)));
            controller?.refresh();
        };
        return {
            object,
            activate() {
                controller = createPlayback(object, animations ?? {}, drawnLayers, ctx.renderer, ctx.isCurrent);
                sync();
                controller.apply(state.playing);
            },
            restore: sync
        };
    },
    code(state) {
        const selection = state.selection === "manual" ? { layers: state.layers } : state.when.length ? { when: state.when } : {};
        const textures = Object.entries(state.textures).filter(([, id]) => id.trim());
        const options: Record<string, unknown> = {};
        if (Object.keys(state.tints).length) options.tints = state.tints;
        if (state.wireframe) options.wireframe = true;
        if (state.flip !== "dataset") options.flip = state.flip === "flip";
        let code = `const key = MineRender.AssetKey.parse("entities", ${JSON.stringify(state.entity)});\n`;
        if (textures.length) code += `const textures = {\n${textures.map(([name, id]) => `    ${JSON.stringify(name)}: MineRender.AssetKey.parse("textures", ${JSON.stringify(id)})`).join(",\n")}\n};\n`;
        const entries = [...Object.entries(selection).map(([name, value]) => `${name}: ${JSON.stringify(value)}`), ...(textures.length ? ["textures"] : [])];
        code += `const model = await MineRender.Entities.getEntity(key, undefined, { ${entries.join(", ")} });\n`;
        code += `const entity = await renderer.scene.addEntity(model${Object.keys(options).length ? `, ${JSON.stringify(options)}` : ""});\n`;
        for (const part of state.hiddenParts) code += `entity.getGroupByName(${JSON.stringify(part.split("/").pop())}).visible = false;\n`;
        if (state.animations.length) {
            code += `const animations = await MineRender.Entities.getAnimations(key);\n`;
            code += `entity.playAnimations([${state.animations.map(name => `animations[${JSON.stringify(name)}]`).join(", ")}], ${JSON.stringify({ loop: state.loop, speed: state.speed, time: state.time })});\n`;
            if (state.playing) code += `renderer.onFrame(({ delta }) => entity.advanceAnimation(delta));\n`;
        }
        return code;
    }
});

app.controls.innerHTML = `
    <fieldset><legend>Entity</legend>
        <label for="entity-input">Entity ID</label><input id="entity-input" type="text" list="entity-suggestions">
        <datalist id="entity-suggestions"></datalist>
        <label for="entity-selection">Geometry</label>
        <select id="entity-selection"><option value="auto">Dataset passes</option><option value="manual">Manual layers</option></select>
        <fieldset id="entity-layers"><legend>Layers</legend><div></div></fieldset>
        <fieldset id="entity-states"><legend>States and colors</legend><div></div></fieldset>
        <label for="entity-flip">Coordinates</label>
        <select id="entity-flip"><option value="dataset">Dataset transform</option><option value="flip">Plain flip</option><option value="raw">Raw model space</option></select>
        <label><input id="entity-wireframe" type="checkbox"> Wireframe</label>
    </fieldset>
    <details><summary>Texture overrides</summary>
        <p class="control-note">Texture asset IDs per draw, for example minecraft:entity/creeper/creeper. Empty uses the dataset texture.</p>
        <div id="entity-textures"></div>
    </details>
    <fieldset><legend>Animation</legend>
        <select id="entity-animation" multiple size="5" aria-label="Animations"></select>
        <p id="entity-animation-help" class="control-note"></p>
        <div class="row"><button id="entity-play" type="button">Play</button><button id="entity-pause" type="button">Pause</button><button id="entity-replay" type="button">Replay</button><button id="entity-stop" type="button">Stop</button></div>
        <label for="entity-time">Time</label><input id="entity-time" type="range" min="0" max="1" step="0.01" value="0"><output id="entity-time-value">0.00 s</output>
        <label for="entity-speed">Speed</label><input id="entity-speed" type="number" min="0.05" max="5" step="0.05" value="1">
        <label><input id="entity-loop" type="checkbox" checked> Loop</label>
    </fieldset>
    <details><summary>Visible parts</summary><div id="entity-parts"></div></details>
    <button id="entity-reset-pose" type="button">Reset pose</button>
`;

function input(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function select(id: string): HTMLSelectElement { return document.getElementById(id) as HTMLSelectElement; }
function update(patch: Partial<EntityState>) { void app.update(patch); }
/** Save a live edit, or reload when no preview is active. Returns whether the edit can be applied directly. */
function record(patch: Partial<EntityState>): boolean {
    if (!activeCurrent?.()) { update(patch); return false; }
    app.record(patch);
    return true;
}
function validateState(state: EntityState) {
    const dictionary = (value: unknown) => value !== null && typeof value === "object" && !Array.isArray(value)
        && Object.values(value).every(entry => typeof entry === "string");
    const strings = (values: unknown) => Array.isArray(values) && values.every(value => typeof value === "string");
    if (typeof state.entity !== "string" || !state.entity.trim() || !["auto", "manual"].includes(state.selection)
        || !["dataset", "flip", "raw"].includes(state.flip) || ![state.wireframe, state.playing, state.loop].every(value => typeof value === "boolean")
        || ![state.layers, state.when, state.hiddenParts, state.animations].every(strings)
        || !dictionary(state.textures) || !dictionary(state.tints)
        || !Number.isFinite(state.time) || state.time < 0 || !Number.isFinite(state.speed) || state.speed < 0.05 || state.speed > 5) {
        throw new Error("Invalid entity configuration.");
    }
}
function checkbox(name: string, checked: boolean, change: (checked: boolean) => void): HTMLLabelElement {
    const label = document.createElement("label");
    const control = document.createElement("input");
    control.type = "checkbox";
    control.checked = checked;
    control.addEventListener("change", () => change(control.checked));
    label.append(control, ` ${name}`);
    return label;
}

function getParts(entity: EntityObject): { key: string, object: Object3D }[] {
    const parts: { key: string, object: Object3D }[] = [];
    const visit = (object: Object3D, path: string) => {
        if (object.name.startsWith("group:")) {
            path += `/${object.name.slice(6)}`;
            parts.push({ key: path, object });
        }
        for (const child of object.children) visit(child, path);
    };
    visit(entity, "");
    return parts;
}

function buildControls(state: EntityState, layers: string[], passes: EntityModelPass[], model: EntityModel, animations: Record<string, EntityAnimation>) {
    input("entity-input").value = state.entity;
    select("entity-selection").value = state.selection;
    select("entity-flip").value = state.flip;
    input("entity-wireframe").checked = state.wireframe;
    const manual = state.selection === "manual";
    const drawnLayers = Object.keys(model.layers ?? { main: model }).map(name => name.split("#")[0]);
    const layerField = document.getElementById("entity-layers") as HTMLFieldSetElement;
    layerField.disabled = !manual;
    layerField.querySelector("div")!.replaceChildren(...layers.map(layer => checkbox(layer, (manual ? state.layers : drawnLayers).includes(layer), checked => {
        const selected = app.state.layers.filter(name => name !== layer);
        if (checked) selected.push(layer);
        update({ layers: selected });
    })));
    const stateField = document.getElementById("entity-states") as HTMLFieldSetElement;
    stateField.disabled = manual;
    const states = [...new Set(passes.map(pass => pass.when).filter((name): name is string => !!name))];
    const tints = [...new Set(passes.map(pass => pass.tint).filter((name): name is string => !!name))];
    stateField.hidden = states.length + tints.length === 0;
    stateField.querySelector("div")!.replaceChildren(...states.map(name => checkbox(name, state.when.includes(name), checked => {
        const enabled = app.state.when.filter(value => value !== name);
        if (checked) enabled.push(name);
        update({ when: enabled });
    })), ...tints.map(name => {
        const label = document.createElement("label");
        const color = document.createElement("input");
        color.type = "color";
        color.value = `#${new Color(state.tints[name] ?? 0xffffff).getHexString()}`;
        color.addEventListener("change", () => update({ tints: { ...app.state.tints, [name]: color.value } }));
        label.append(`${name} `, color);
        return label;
    }));
    document.getElementById("entity-textures")!.replaceChildren(...Object.entries(model.layers ?? { main: model }).map(([name, layer]) => {
        const label = document.createElement("label");
        const texture = document.createElement("input");
        texture.type = "text";
        texture.value = state.textures[name] ?? "";
        texture.placeholder = layer.texture?.toNamespacedString() ?? "";
        texture.addEventListener("change", () => update({ textures: { ...app.state.textures, [name]: texture.value.trim() } }));
        label.append(`${name} (${layer.render ?? layer.layer.render ?? "cutout"})`, texture);
        return label;
    }));
    document.getElementById("entity-parts")!.replaceChildren(...activeParts.map(part => checkbox(part.key.slice(1).split("/").join(" / "), part.object.visible, checked => {
        const hidden = app.state.hiddenParts.filter(key => key !== part.key);
        if (!checked) hidden.push(part.key);
        if (!record({ hiddenParts: hidden })) return;
        part.object.visible = checked;
        activeEntity?.notifyDirty();
    })));
    const picker = select("entity-animation");
    picker.replaceChildren(...Object.entries(animations).map(([name, animation]) => {
        const layer = animation.layer ?? "main";
        const option = new Option(`${name} (${layer})`, name, false, state.animations.includes(name));
        option.disabled = !drawnLayers.includes(layer);
        if (option.disabled) option.title = `Draw the ${layer} layer to enable this clip.`;
        return option;
    }));
    const names = Object.keys(animations);
    document.getElementById("entity-animation-help")!.textContent = names.length
        ? (names.some(name => (animations[name].layer ?? "main") !== "main") ? "One clip per layer; Ctrl/Cmd+click selects several." : "")
        : "No keyframe animations for this entity in the selected version.";
    input("entity-speed").value = String(state.speed);
    input("entity-loop").checked = state.loop;
}

function createPlayback(object: EntityObject, animations: Record<string, EntityAnimation>, drawnLayers: string[], renderer: Renderer, isCurrent: () => boolean) {
    let unsubscribe: (() => void) | undefined;
    /** The saved selection reduced to known clips on drawn layers, the last chosen clip per layer winning. */
    const selectedClips = (): { names: string[], clips: EntityAnimation[] } => {
        const byLayer = new Map<string, string>();
        for (const name of app.state.animations) {
            const clip = Object.prototype.hasOwnProperty.call(animations, name) ? animations[name] : undefined;
            if (clip && drawnLayers.includes(clip.layer ?? "main")) byLayer.set(clip.layer ?? "main", name);
        }
        const names = [...byLayer.values()];
        return { names, clips: names.map(name => animations[name]) };
    };
    const duration = (clips: EntityAnimation[]) => Math.max(0, ...clips.map(clip => clip.length));
    const elapsed = () => {
        const length = duration(object.activeAnimations as EntityAnimation[]);
        return app.state.loop && length > 0 ? object.animationTime % length : Math.min(object.animationTime, length);
    };
    function pauseFrames() { unsubscribe?.(); unsubscribe = undefined; }
    function updateTime() {
        input("entity-time").value = String(elapsed());
        document.getElementById("entity-time-value")!.textContent = `${elapsed().toFixed(2)} s`;
    }
    function controls() {
        const { names, clips } = selectedClips();
        for (const option of select("entity-animation").options) option.selected = names.includes(option.value);
        input("entity-time").max = String(duration(clips) || 1);
        input("entity-time").disabled = !clips.length;
        for (const id of ["entity-play", "entity-pause", "entity-replay", "entity-stop"]) (document.getElementById(id) as HTMLButtonElement).disabled = !clips.length;
        document.getElementById("entity-play")!.setAttribute("aria-pressed", String(app.state.playing));
    }
    function apply(playing: boolean) {
        pauseFrames();
        const { names, clips } = selectedClips();
        if (!clips.length) {
            object.stopAnimation();
            app.record({ animations: [], playing: false, time: 0 });
            controls();
            updateTime();
            return;
        }
        const length = duration(clips);
        const speed = Math.min(5, Math.max(0.05, Number(app.state.speed) || 1));
        const time = Math.max(0, Math.min(length, Number(app.state.time) || 0));
        app.record({ animations: names, playing, speed, time });
        object.playAnimations(clips, { time, speed, loop: app.state.loop });
        if (playing) {
            unsubscribe = renderer.onFrame(({ delta }) => {
                if (!isCurrent()) { pauseFrames(); return; }
                object.advanceAnimation(delta);
                if (!app.state.loop && object.animationTime >= length) {
                    object.setAnimationTime(length);
                    pauseFrames();
                    app.record({ playing: false });
                    controls();
                }
                app.record({ time: elapsed() });
                updateTime();
            });
        }
        controls();
        updateTime();
    }
    return {
        apply,
        refresh() { controls(); updateTime(); },
        pause() { pauseFrames(); app.record({ playing: false }); controls(); },
        stop() { pauseFrames(); object.stopAnimation(); app.record({ playing: false, time: 0 }); controls(); updateTime(); },
        seek(time: number) { app.record({ time, playing: false }); apply(false); },
        dispose() { pauseFrames(); object.stopAnimation(); }
    };
}

input("entity-input").value = app.state.entity;
input("entity-input").addEventListener("change", () => update({ ...defaults, entity: input("entity-input").value.trim() }));
select("entity-selection").addEventListener("change", () => update({ selection: select("entity-selection").value as EntityState["selection"] }));
select("entity-flip").addEventListener("change", () => update({ flip: select("entity-flip").value as EntityState["flip"] }));
input("entity-wireframe").addEventListener("change", () => update({ wireframe: input("entity-wireframe").checked }));
select("entity-animation").addEventListener("change", () => {
    // Newly chosen clips go last so they replace an earlier clip on the same layer.
    const chosen = Array.from(select("entity-animation").selectedOptions, option => option.value);
    const previous = app.state.animations.filter(name => chosen.includes(name));
    const animations = [...previous, ...chosen.filter(name => !previous.includes(name))];
    if (record({ animations, time: 0, playing: true })) playback?.apply(true);
});
document.getElementById("entity-play")!.addEventListener("click", () => {
    if (!record({ playing: true })) return;
    const length = Math.max(0, ...(activeEntity?.activeAnimations ?? []).map(clip => clip.length));
    if (length && app.state.time >= length) app.record({ time: 0 });
    playback?.apply(true);
});
document.getElementById("entity-pause")!.addEventListener("click", () => { if (record({ playing: false })) playback?.pause(); });
document.getElementById("entity-replay")!.addEventListener("click", () => { if (record({ playing: true, time: 0 })) playback?.apply(true); });
document.getElementById("entity-stop")!.addEventListener("click", () => { if (record({ playing: false, time: 0 })) playback?.stop(); });
input("entity-time").addEventListener("input", () => {
    const time = Number(input("entity-time").value);
    if (record({ time, playing: false })) playback?.seek(time);
});
input("entity-speed").addEventListener("change", () => {
    const speed = Math.max(0.05, Math.min(5, Number(input("entity-speed").value) || 1));
    input("entity-speed").value = String(speed);
    if (record({ speed })) playback?.apply(app.state.playing);
});
input("entity-loop").addEventListener("change", () => { if (record({ loop: input("entity-loop").checked })) playback?.apply(app.state.playing); });
document.getElementById("entity-reset-pose")!.addEventListener("click", () => {
    if (!record({ animations: [], playing: false, time: 0 })) return;
    resetPose();
    playback?.apply(false);
});
window["setEntity"] = (entity: string, layers?: string[], when: string[] = [], tints: Record<string, string> = {}) => app.update({
    ...defaults, entity, selection: layers ? "manual" : "auto", layers: layers ?? ["main"], when, tints
});
window["playAnimations"] = (animations: string[] = []) => { if (record({ animations, time: 0, playing: animations.length > 0 })) playback?.apply(animations.length > 0); };
window["playAnimation"] = (animation = "") => window["playAnimations"](animation ? [animation] : []);
void app.start();
