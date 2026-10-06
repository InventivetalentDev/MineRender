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
    animation: string;
    playing: boolean;
    time: number;
    speed: number;
    loop: boolean;
}

const defaults: EntityState = {
    entity: "bat", selection: "auto", layers: ["main"], when: [], tints: {}, textures: {}, flip: "dataset",
    wireframe: false, hiddenParts: [], animation: "", playing: false, time: 0, speed: 1, loop: true
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
        bat: { label: "Bat (flying animation)", state: { animation: "flying", playing: true } },
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
                controller = createPlayback(object, animations ?? {}, ctx.renderer, ctx.isCurrent);
                app.record({ animation: Object.prototype.hasOwnProperty.call(animations ?? {}, state.animation) ? state.animation : "" });
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
        if (state.animation) {
            code += `const animations = await MineRender.Entities.getAnimations(key);\n`;
            code += `entity.playAnimation(animations[${JSON.stringify(state.animation)}], ${JSON.stringify({ loop: state.loop, speed: state.speed, time: state.time })});\n`;
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
        <select id="entity-animation" aria-label="Animation"><option value="">None</option></select>
        <p id="entity-animation-help" class="control-note"></p>
        <div class="row"><button id="entity-play" type="button">Play</button><button id="entity-pause" type="button">Pause</button><button id="entity-stop" type="button">Stop</button></div>
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
    if (typeof state.entity !== "string" || !state.entity.trim() || !["auto", "manual"].includes(state.selection)
        || !["dataset", "flip", "raw"].includes(state.flip) || ![state.wireframe, state.playing, state.loop].every(value => typeof value === "boolean")
        || ![state.layers, state.when, state.hiddenParts].every(values => Array.isArray(values) && values.every(value => typeof value === "string"))
        || !dictionary(state.textures) || !dictionary(state.tints) || typeof state.animation !== "string"
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
    const names = Object.keys(animations);
    select("entity-animation").replaceChildren(new Option("None", ""), ...names.map(name => new Option(name)));
    select("entity-animation").value = state.animation;
    document.getElementById("entity-animation-help")!.textContent = names.length ? "" : "No keyframe animations for this entity in the selected version.";
    input("entity-speed").value = String(state.speed);
    input("entity-loop").checked = state.loop;
}

function createPlayback(object: EntityObject, animations: Record<string, EntityAnimation>, renderer: Renderer, isCurrent: () => boolean) {
    let unsubscribe: (() => void) | undefined;
    const selectedAnimation = () => Object.prototype.hasOwnProperty.call(animations, app.state.animation) ? animations[app.state.animation] : undefined;
    const elapsed = () => {
        const animation = object.animation;
        return animation && app.state.loop && animation.length > 0 ? object.animationTime % animation.length : object.animationTime;
    };
    function pauseFrames() { unsubscribe?.(); unsubscribe = undefined; }
    function updateTime() {
        input("entity-time").value = String(elapsed());
        document.getElementById("entity-time-value")!.textContent = `${elapsed().toFixed(2)} s`;
    }
    function controls() {
        const animation = selectedAnimation();
        input("entity-time").max = String(animation?.length ?? 1);
        input("entity-time").disabled = !animation;
        for (const id of ["entity-play", "entity-pause", "entity-stop"]) (document.getElementById(id) as HTMLButtonElement).disabled = !animation;
        document.getElementById("entity-play")!.setAttribute("aria-pressed", String(app.state.playing));
    }
    function apply(playing: boolean) {
        pauseFrames();
        const animation = selectedAnimation();
        if (!animation) {
            object.stopAnimation();
            app.record({ animation: "", playing: false, time: 0 });
            select("entity-animation").value = "";
            controls();
            updateTime();
            return;
        }
        const speed = Math.min(5, Math.max(0.05, Number(app.state.speed) || 1));
        const time = Math.max(0, Math.min(animation.length, Number(app.state.time) || 0));
        app.record({ playing, speed, time });
        object.playAnimation(animation, { time, speed, loop: app.state.loop });
        if (playing) {
            unsubscribe = renderer.onFrame(({ delta }) => {
                if (!isCurrent()) { pauseFrames(); return; }
                object.advanceAnimation(delta);
                if (!app.state.loop && object.animationTime >= animation.length) {
                    object.setAnimationTime(animation.length);
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
    if (record({ animation: select("entity-animation").value, time: 0, playing: true })) playback?.apply(true);
});
document.getElementById("entity-play")!.addEventListener("click", () => {
    if (!record({ playing: true })) return;
    if (activeEntity?.animation && app.state.time >= activeEntity.animation.length) app.record({ time: 0 });
    playback?.apply(true);
});
document.getElementById("entity-pause")!.addEventListener("click", () => { if (record({ playing: false })) playback?.pause(); });
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
    if (!record({ animation: "", playing: false, time: 0 })) return;
    resetPose();
    playback?.apply(false);
});
window["setEntity"] = (entity: string, layers?: string[], when: string[] = [], tints: Record<string, string> = {}) => app.update({
    ...defaults, entity, selection: layers ? "manual" : "auto", layers: layers ?? ["main"], when, tints
});
window["playAnimation"] = (animation = "") => { if (record({ animation, time: 0, playing: !!animation })) playback?.apply(!!animation); };
void app.start();
