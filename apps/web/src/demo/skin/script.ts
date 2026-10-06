import { CapeLayout, SkinObject, Skins } from "minerender";
import { Playground } from "../../playground/Playground";

interface SkinState {
    skin: string;
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
const poses: Record<string, Record<string, [number, number, number]>> = {
    neutral: {},
    wave: { rightArm: [0, 0, -150], head: [0, -15, 0] },
    stride: { rightArm: [-30, 0, 0], leftArm: [30, 0, 0], rightLeg: [30, 0, 0], leftLeg: [-30, 0, 0] },
    flying: { rightArm: [0, 0, -90], leftArm: [0, 0, 90], head: [-15, 0, 0] }
};
let skinFile: { name: string, url: string } | undefined;
let capeFile: { name: string, url: string } | undefined;
let activeSkinFile: typeof skinFile;
let activeCapeFile: typeof capeFile;
let activeSkin: SkinObject | undefined;
let activeCurrent: (() => boolean) | undefined;
const fileURLs = new Set<string>();

const app = new Playground<SkinState>({
    title: "Skin playground",
    defaults: {
        skin: "inventivetalent", skinFile: "", cape: "", capeFile: "", model: "auto", layout: "auto",
        capeLayout: "minecraft", pose: "neutral", hiddenParts: [], hiddenOverlays: []
    },
    renderer: { camera: { near: 1, far: 2000, position: [50, 35, 50] } },
    presets: {
        player: { label: "Player", state: { skin: "inventivetalent", skinFile: "", pose: "neutral", model: "auto", layout: "auto" } },
        wave: { label: "Wave", state: { pose: "wave" } },
        stride: { label: "Walking pose", state: { pose: "stride" } }
    },
    async load(ctx, state) {
        validateState(state);
        const loadedSkinFile = state.skinFile ? skinFile : undefined;
        const loadedCapeFile = state.capeFile ? capeFile : undefined;
        ctx.onCleanup(releaseUnusedFiles);
        const source = await resolveTexture(state.skin, state.skinFile, loadedSkinFile);
        if (!ctx.isCurrent()) return;
        if (!source) throw new Error("Enter a player name, UUID, or skin URL, or choose a PNG.");
        const object = new SkinObject({
            slim: state.model === "auto" ? undefined : state.model === "slim",
            legacy: state.layout === "auto" ? undefined : state.layout === "legacy"
        });
        object.scene = ctx.renderer.scene;
        ctx.onCleanup(() => object.dispose());
        await object.init();
        await object.setSkinTexture(source);
        if (!ctx.isCurrent()) return;
        const cape = await resolveTexture(state.cape, state.capeFile, loadedCapeFile, state.capeLayout);
        if (state.cape && !cape) throw new Error("No cape found for this player and cape layout.");
        await object.setCapeTexture(cape, state.capeLayout);
        applyPose(object, state.pose);
        for (const part of parts) object.toggleGroupVisibility(part, !state.hiddenParts.includes(part));
        for (const part of overlays) object.toggleMeshVisibility(part, !state.hiddenOverlays.includes(part));
        ctx.renderer.scene.add(object);
        const restore = () => {
            activeSkin = object;
            activeCurrent = ctx.isCurrent;
            activeSkinFile = skinFile = loadedSkinFile;
            activeCapeFile = capeFile = loadedCapeFile;
            window["skin"] = object;
            syncControls(app.state);
        };
        return {
            object,
            activate: restore,
            restore() {
                restore();
                input("skin-file").value = input("cape-file").value = "";
                releaseUnusedFiles();
            }
        };
    },
    code(state) {
        const options = {
            ...(state.model !== "auto" ? { slim: state.model === "slim" } : {}),
            ...(state.layout !== "auto" ? { legacy: state.layout === "legacy" } : {})
        };
        const source = (value: string, filename: string, cape = false) => filename
            ? `await selectPNG(${JSON.stringify(filename)})`
            : /^https?:\/\//i.test(value) ? JSON.stringify(value)
                : cape ? `await MineRender.Skins.capeFromCapesDev(${JSON.stringify(value)}, ${JSON.stringify(state.capeLayout)})`
                    : `await MineRender.Skins.fromUuidOrUsername(${JSON.stringify(value)})`;
        const filePicker = state.skinFile || state.capeFile ? `const localURLs = [];
function selectPNG(filename) {
    const label = document.createElement("label");
    label.textContent = "Select " + filename;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png";
    label.append(input);
    document.body.append(label);
    return new Promise(resolve => input.addEventListener("change", () => {
        if (!input.files[0]) return;
        const url = URL.createObjectURL(input.files[0]);
        localURLs.push(url);
        resolve(url);
        label.remove();
    }, { once: true }));
}
` : "";
        return `${filePicker}const skinSource = ${source(state.skin, state.skinFile)};
if (!skinSource) throw new Error("Skin not found");
const skin = await renderer.scene.addSkin(skinSource, ${JSON.stringify(options)});
${state.cape || state.capeFile ? `await skin.setCapeTexture(${source(state.cape, state.capeFile, true)}, ${JSON.stringify(state.capeLayout)});\n` : ""}const rotations = ${JSON.stringify(poses[state.pose] ?? {})};
for (const [name, degrees] of Object.entries(rotations)) skin.getGroupByName(name)?.rotation.set(...degrees.map(value => value * Math.PI / 180));
for (const name of ${JSON.stringify(state.hiddenParts)}) skin.toggleGroupVisibility(name, false);
for (const name of ${JSON.stringify(state.hiddenOverlays)}) skin.toggleMeshVisibility(name, false);
skin.notifyDirty();${state.skinFile || state.capeFile ? "\nlocalURLs.forEach(url => URL.revokeObjectURL(url));" : ""}`;
    }
});

app.controls.innerHTML = `
    <fieldset><legend>Skin</legend>
        <label for="skin-input">Player name, UUID, or PNG URL</label>
        <input id="skin-input" type="text" autocomplete="off">
        <label for="skin-file">Local skin PNG</label><input id="skin-file" type="file" accept="image/png,.png">
        <div id="skin-file-name"></div>
        <label for="skin-model">Arm model</label>
        <select id="skin-model"><option value="auto">Auto detect</option><option value="classic">Classic</option><option value="slim">Slim</option></select>
        <label for="skin-layout">Texture layout</label>
        <select id="skin-layout"><option value="auto">Auto detect</option><option value="modern">Modern (square)</option><option value="legacy">Legacy (64 × 32)</option></select>
    </fieldset>
    <fieldset><legend>Cape</legend>
        <label for="cape-input">Player name, UUID, or PNG URL</label><input id="cape-input" type="text" autocomplete="off" placeholder="No cape">
        <label for="cape-file">Local cape PNG</label><input id="cape-file" type="file" accept="image/png,.png">
        <div id="cape-file-name"></div>
        <label for="cape-type">Cape layout</label>
        <select id="cape-type"><option value="minecraft">Minecraft</option><option value="optifine">OptiFine</option><option value="labymod">LabyMod</option></select>
        <button id="cape-clear" type="button">Clear cape</button>
    </fieldset>
    <fieldset><legend>Pose</legend>
        <label for="skin-pose">Pose preset</label>
        <select id="skin-pose"><option value="neutral">Neutral</option><option value="wave">Wave</option><option value="stride">Walking pose</option><option value="flying">Arms out</option></select>
        <button id="skin-reset-pose" type="button">Reset pose</button>
        <p>Left and right refer to the player. Use the inspector to adjust individual parts.</p>
    </fieldset>
    <details open><summary>Visible parts</summary><div id="skin-parts"></div></details>
    <details><summary>Visible overlays</summary><div id="skin-overlays"></div></details>
    <p>Local PNGs stay in this browser. Shared configurations require you to select them again.</p>
`;

function input(id: string): HTMLInputElement { return document.getElementById(id) as HTMLInputElement; }
function select(id: string): HTMLSelectElement { return document.getElementById(id) as HTMLSelectElement; }
function update(patch: Partial<SkinState>) { void app.update(patch).catch(error => app.report(String(error), true)); }

function releaseUnusedFiles() {
    const retained = [skinFile?.url, capeFile?.url, activeSkinFile?.url, activeCapeFile?.url];
    for (const url of fileURLs) {
        if (retained.includes(url)) continue;
        URL.revokeObjectURL(url);
        fileURLs.delete(url);
    }
}

function validateState(state: SkinState) {
    if (![state.skin, state.skinFile, state.cape, state.capeFile].every(value => typeof value === "string")
        || !["auto", "classic", "slim"].includes(state.model) || !["auto", "modern", "legacy"].includes(state.layout)
        || !["minecraft", "optifine", "labymod"].includes(state.capeLayout) || !Object.prototype.hasOwnProperty.call(poses, state.pose)
        || ![state.hiddenParts, state.hiddenOverlays].every(values => Array.isArray(values) && values.every(value => typeof value === "string"))) {
        throw new Error("Invalid skin configuration. Check the skin, model, layout, pose, and visible parts.");
    }
}

async function resolveTexture(value: string, filename: string, file?: { name: string, url: string }, layout?: CapeLayout): Promise<string | undefined> {
    if (filename) {
        if (!file || file.name !== filename) throw new Error(`Select the local PNG again: ${filename}`);
        return file.url;
    }
    value = value.trim();
    if (!value) return undefined;
    if (/^https?:\/\//i.test(value)) return value;
    return layout ? Skins.capeFromCapesDev(value, layout) : Skins.fromUuidOrUsername(value);
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
        checkbox.disabled = true;
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
    input("skin-input").value = state.skin;
    input("cape-input").value = state.cape;
    select("skin-model").value = state.model;
    select("skin-layout").value = state.layout;
    select("cape-type").value = state.capeLayout;
    select("skin-pose").value = state.pose;
    document.getElementById("skin-file-name")!.textContent = state.skinFile ? `Selected: ${state.skinFile}` : "";
    document.getElementById("cape-file-name")!.textContent = state.capeFile ? `Selected: ${state.capeFile}` : "";
    for (const [container, hidden] of [["skin-parts", state.hiddenParts], ["skin-overlays", state.hiddenOverlays]] as const) {
        document.getElementById(container)!.querySelectorAll<HTMLInputElement>("input").forEach(checkbox => {
            checkbox.checked = !hidden.includes(checkbox.dataset.part!);
            checkbox.disabled = checkbox.dataset.part === "cape" && !state.cape && !state.capeFile;
        });
    }
}

input("skin-input").addEventListener("change", () => {
    input("skin-file").value = "";
    update({ skin: input("skin-input").value.trim(), skinFile: "" });
});
input("cape-input").addEventListener("change", () => {
    input("cape-file").value = "";
    update({ cape: input("cape-input").value.trim(), capeFile: "" });
});
for (const kind of ["skin", "cape"] as const) {
    input(`${kind}-file`).addEventListener("change", () => {
        const file = input(`${kind}-file`).files?.[0];
        if (!file) return;
        const local = { name: file.name, url: URL.createObjectURL(file) };
        fileURLs.add(local.url);
        if (kind === "skin") skinFile = local;
        else capeFile = local;
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
document.getElementById("skin-reset-pose")!.addEventListener("click", () => update({ pose: "neutral" }));
document.getElementById("cape-clear")!.addEventListener("click", () => {
    input("cape-file").value = "";
    update({ cape: "", capeFile: "" });
});
visibilityControls(parts, "skin-parts", "hiddenParts");
visibilityControls(overlays, "skin-overlays", "hiddenOverlays");
try { validateState(app.state); syncControls(app.state); } catch { /* The loader reports invalid shared configurations. */ }
window.addEventListener("pagehide", event => { if (!event.persisted) fileURLs.forEach(url => URL.revokeObjectURL(url)); });
window["setSkin"] = (skin: string) => app.update({ skin, skinFile: "" });
window["setCape"] = (cape: string, capeLayout: CapeLayout = app.state.capeLayout) => app.update({ cape, capeFile: "", capeLayout });
void app.start();
