import { CapeLayout, SkinObject, Skins } from "minerender";
import { Playground } from "../../playground/Playground";

interface SkinState {
    /** Player name, UUID, or PNG URL. */
    skin: string;
    /** Name of a locally selected PNG; the file itself is not saved. */
    skinFile: string;
    cape: string;
    capeFile: string;
    model: "auto" | "classic" | "slim";
    layout: "auto" | "modern" | "legacy";
    capeLayout: CapeLayout;
    pose: string;
    hiddenParts: string[];
    hiddenOverlays: string[];
}

const parts = ["head", "body", "leftArm", "rightArm", "leftLeg", "rightLeg", "cape"];
const overlays = ["hat", "jacket", "leftSleeve", "rightSleeve", "leftTrousers", "rightTrousers"];
const labels: Record<string, string> = {
    head: "Head", body: "Body", leftArm: "Left arm", rightArm: "Right arm", leftLeg: "Left leg", rightLeg: "Right leg", cape: "Cape",
    hat: "Hat", jacket: "Jacket", leftSleeve: "Left sleeve", rightSleeve: "Right sleeve", leftTrousers: "Left trousers", rightTrousers: "Right trousers"
};
/** Rotations in degrees per part. */
const poses: Record<string, Record<string, [number, number, number]>> = {
    neutral: {},
    wave: { rightArm: [0, 0, -150], head: [0, -15, 0] },
    walk: { rightArm: [-30, 0, 0], leftArm: [30, 0, 0], rightLeg: [30, 0, 0], leftLeg: [-30, 0, 0] },
    arms: { rightArm: [0, 0, -90], leftArm: [0, 0, 90], head: [-15, 0, 0] }
};

type LocalFile = { name: string, url: string };
const localFiles: { skin?: LocalFile, cape?: LocalFile } = {};
let activeSkin: SkinObject | undefined;
let activeCurrent: (() => boolean) | undefined;

const app = new Playground<SkinState>({
    title: "Player skins",
    defaults: {
        skin: "inventivetalent", skinFile: "", cape: "", capeFile: "", model: "auto", layout: "auto",
        capeLayout: "minecraft", pose: "neutral", hiddenParts: [], hiddenOverlays: []
    },
    renderer: { camera: { near: 1, far: 2000, position: [50, 35, 50] } },
    presets: {
        wave: { label: "Waving", state: { pose: "wave" } },
        walk: { label: "Walking", state: { pose: "walk" } },
        base: { label: "Base layer only", state: { hiddenOverlays: [...overlays] } }
    },
    async load(ctx, state) {
        validateState(state);
        const skinSource = await resolveTexture(state.skin, state.skinFile, localFiles.skin);
        if (!skinSource) throw new Error("Enter a player name, UUID, or skin URL, or choose a PNG.");
        const object = new SkinObject({
            slim: state.model === "auto" ? undefined : state.model === "slim",
            legacy: state.layout === "auto" ? undefined : state.layout === "legacy"
        });
        object.scene = ctx.renderer.scene;
        ctx.onCleanup(() => object.dispose());
        await object.init();
        await object.setSkinTexture(skinSource);
        if (!ctx.isCurrent()) return;
        const capeSource = await resolveTexture(state.cape, state.capeFile, localFiles.cape, state.capeLayout);
        if (state.cape && !capeSource) throw new Error("No cape found for this player and cape layout.");
        await object.setCapeTexture(capeSource, state.capeLayout);
        applyPose(object, state.pose);
        for (const part of parts) object.toggleGroupVisibility(part, !state.hiddenParts.includes(part));
        for (const part of overlays) object.toggleMeshVisibility(part, !state.hiddenOverlays.includes(part));
        ctx.renderer.scene.add(object);
        return {
            object,
            activate() {
                activeSkin = object;
                activeCurrent = ctx.isCurrent;
                window["skin"] = object;
                syncControls(app.state);
            }
        };
    },
    code(state) {
        const options = {
            ...(state.model !== "auto" ? { slim: state.model === "slim" } : {}),
            ...(state.layout !== "auto" ? { legacy: state.layout === "legacy" } : {})
        };
        const source = (value: string, filename: string, cape = false) => filename ? `/* ${filename} */ localPngUrl`
            : /^https?:\/\//i.test(value) ? JSON.stringify(value)
                : cape ? `await MineRender.Skins.capeFromCapesDev(${JSON.stringify(value)}, ${JSON.stringify(state.capeLayout)})`
                    : `await MineRender.Skins.fromUuidOrUsername(${JSON.stringify(value)})`;
        let code = `const skin = await renderer.scene.addSkin(${source(state.skin, state.skinFile)}, ${JSON.stringify(options)});\n`;
        if (state.cape || state.capeFile) code += `await skin.setCapeTexture(${source(state.cape, state.capeFile, true)}, ${JSON.stringify(state.capeLayout)});\n`;
        for (const [name, degrees] of Object.entries(poses[state.pose] ?? {})) {
            code += `skin.getGroupByName(${JSON.stringify(name)}).rotation.set(${degrees.map(value => value ? `${value} * Math.PI / 180` : "0").join(", ")});\n`;
        }
        for (const name of state.hiddenParts) code += `skin.toggleGroupVisibility(${JSON.stringify(name)}, false);\n`;
        for (const name of state.hiddenOverlays) code += `skin.toggleMeshVisibility(${JSON.stringify(name)}, false);\n`;
        if (state.pose !== "neutral" || state.hiddenParts.length || state.hiddenOverlays.length) code += "skin.notifyDirty();\n";
        return code;
    }
});

app.controls.innerHTML = `
    <fieldset><legend>Skin</legend>
        <label for="skin-input">Player name, UUID, or PNG URL</label>
        <input id="skin-input" type="text" autocomplete="off">
        <label for="skin-file">Local PNG</label><input id="skin-file" type="file" accept="image/png,.png">
        <label for="skin-model">Arms</label>
        <select id="skin-model"><option value="auto">Detect</option><option value="classic">Classic</option><option value="slim">Slim</option></select>
        <label for="skin-layout">Texture layout</label>
        <select id="skin-layout"><option value="auto">Detect</option><option value="modern">64 × 64</option><option value="legacy">64 × 32</option></select>
    </fieldset>
    <fieldset><legend>Cape</legend>
        <label for="cape-input">Player name, UUID, or PNG URL</label><input id="cape-input" type="text" autocomplete="off" placeholder="None">
        <label for="cape-file">Local PNG</label><input id="cape-file" type="file" accept="image/png,.png">
        <label for="cape-type">Layout</label>
        <select id="cape-type"><option value="minecraft">Minecraft</option><option value="optifine">OptiFine</option><option value="labymod">LabyMod</option></select>
        <button id="cape-clear" type="button">Remove cape</button>
    </fieldset>
    <fieldset><legend>Pose</legend>
        <select id="skin-pose" aria-label="Pose"><option value="neutral">Neutral</option><option value="wave">Wave</option><option value="walk">Walk</option><option value="arms">Arms out</option></select>
        <p class="control-note">Left and right are the player's own. Use the inspector for individual parts.</p>
    </fieldset>
    <fieldset><legend>Visible parts</legend><div id="skin-parts"></div></fieldset>
    <fieldset><legend>Visible overlays</legend><div id="skin-overlays"></div></fieldset>
`;

function input(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function select(id: string): HTMLSelectElement { return document.getElementById(id) as HTMLSelectElement; }
function update(patch: Partial<SkinState>) { void app.update(patch); }

function validateState(state: SkinState) {
    if (![state.skin, state.skinFile, state.cape, state.capeFile].every(value => typeof value === "string")
        || !["auto", "classic", "slim"].includes(state.model) || !["auto", "modern", "legacy"].includes(state.layout)
        || !["minecraft", "optifine", "labymod"].includes(state.capeLayout) || !Object.prototype.hasOwnProperty.call(poses, state.pose)
        || ![state.hiddenParts, state.hiddenOverlays].every(values => Array.isArray(values) && values.every(value => typeof value === "string"))) {
        throw new Error("Invalid skin configuration.");
    }
}

async function resolveTexture(value: string, filename: string, file?: LocalFile, capeLayout?: CapeLayout): Promise<string | undefined> {
    if (filename) {
        if (!file || file.name !== filename) throw new Error(`Select the local PNG again: ${filename}`);
        return file.url;
    }
    value = value.trim();
    if (!value) return undefined;
    if (/^https?:\/\//i.test(value)) return value;
    return capeLayout ? Skins.capeFromCapesDev(value, capeLayout) : Skins.fromUuidOrUsername(value);
}

function applyPose(object: SkinObject, pose: string) {
    for (const name of parts) {
        const group = object.getGroupByName(name);
        if (!group) continue;
        group.rotation.set(0, 0, 0);
        if (name === "cape") group.rotation.x = Math.PI / 30;
    }
    for (const [part, angles] of Object.entries(poses[pose] ?? {})) {
        object.getGroupByName(part)?.rotation.set(...angles.map(angle => angle * Math.PI / 180) as [number, number, number]);
    }
    object.notifyDirty();
}

function visibilityControls(names: string[], container: string, key: "hiddenParts" | "hiddenOverlays") {
    for (const name of names) {
        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.dataset.part = name;
        checkbox.checked = true;
        checkbox.addEventListener("change", () => {
            const hidden = app.state[key].filter(part => part !== name);
            if (!checkbox.checked) hidden.push(name);
            if (!activeCurrent?.()) return update({ [key]: hidden });
            app.record({ [key]: hidden });
            if (key === "hiddenParts") activeSkin?.toggleGroupVisibility(name, checkbox.checked);
            else activeSkin?.toggleMeshVisibility(name, checkbox.checked);
        });
        label.append(checkbox, ` ${labels[name]}`);
        document.getElementById(container)!.append(label);
    }
}

function syncControls(state: SkinState) {
    for (const kind of ["skin", "cape"] as const) {
        const file = state[`${kind}File`];
        input(`${kind}-input`).value = file ? "" : state[kind];
        input(`${kind}-input`).placeholder = file ? `Local file: ${file}` : kind === "cape" ? "None" : "";
        input(`${kind}-file`).value = "";
    }
    select("skin-model").value = state.model;
    select("skin-layout").value = state.layout;
    select("cape-type").value = state.capeLayout;
    select("skin-pose").value = state.pose;
    for (const [container, hidden] of [["skin-parts", state.hiddenParts], ["skin-overlays", state.hiddenOverlays]] as const) {
        document.getElementById(container)!.querySelectorAll<HTMLInputElement>("input").forEach(checkbox => {
            checkbox.checked = !hidden.includes(checkbox.dataset.part!);
            checkbox.disabled = checkbox.dataset.part === "cape" && !state.cape && !state.capeFile;
        });
    }
}

input("skin-input").addEventListener("change", () => update({ skin: input("skin-input").value.trim(), skinFile: "" }));
input("cape-input").addEventListener("change", () => update({ cape: input("cape-input").value.trim(), capeFile: "" }));
for (const kind of ["skin", "cape"] as const) {
    input(`${kind}-file`).addEventListener("change", () => {
        const file = input(`${kind}-file`).files?.[0];
        if (!file) return;
        if (localFiles[kind]) URL.revokeObjectURL(localFiles[kind]!.url);
        localFiles[kind] = { name: file.name, url: URL.createObjectURL(file) };
        update({ [`${kind}File`]: file.name });
    });
}
select("skin-model").addEventListener("change", () => update({ model: select("skin-model").value as SkinState["model"] }));
select("skin-layout").addEventListener("change", () => update({ layout: select("skin-layout").value as SkinState["layout"] }));
select("cape-type").addEventListener("change", () => update({ capeLayout: select("cape-type").value as CapeLayout }));
select("skin-pose").addEventListener("change", () => {
    const pose = select("skin-pose").value;
    if (!activeCurrent?.()) return update({ pose });
    app.record({ pose });
    if (activeSkin) applyPose(activeSkin, pose);
});
document.getElementById("cape-clear")!.addEventListener("click", () => update({ cape: "", capeFile: "" }));
visibilityControls(parts, "skin-parts", "hiddenParts");
visibilityControls(overlays, "skin-overlays", "hiddenOverlays");
try { validateState(app.state); syncControls(app.state); } catch { /* reported by the first load */ }
window["setSkin"] = (skin: string) => app.update({ skin, skinFile: "" });
window["setCape"] = (cape: string, capeLayout: CapeLayout = app.state.capeLayout) => app.update({ cape, capeFile: "", capeLayout });
void app.start();
