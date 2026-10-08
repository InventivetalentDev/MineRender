import { AssetKey, DISPLAY_POSITIONS, Entities, type SceneObjectDefinition, type SceneSkinDefinition, type SceneSkinPosePart } from "minerender";
import { Color } from "three";
import { getBlockProperties, getObjectList } from "./catalog";

interface InspectorContext {
    onChange: (definition: SceneObjectDefinition) => void;
    onError: (error: unknown) => void;
    getAnimationTime?: () => number;
    onSkinPoseChange?: (pose: SceneSkinDefinition["pose"]) => void;
}

let nextListId = 0;

export function renderInspector(container: HTMLElement, definition: SceneObjectDefinition, context: InspectorContext): () => void {
    const draft = structuredClone(definition);
    let active = true;
    container.replaceChildren();
    const emit = () => { if (active) context.onChange(structuredClone(draft)); };
    const fail = (error: unknown) => { if (active) context.onError(error); };
    const options = (patch: Record<string, unknown>) => {
        if (draft.type === "gui") return;
        draft.options = Object.assign({}, draft.options, patch);
        emit();
    };

    if ("asset" in draft) {
        const field = text(container, `${draft.type === "model" ? "Model" : draft.type[0].toUpperCase() + draft.type.slice(1)} ID`, draft.asset);
        field.addEventListener("change", () => {
            draft.asset = field.value.trim();
            if (draft.type === "block") draft.state = {};
            if (draft.type === "entity") {
                delete draft.layers;
                delete draft.when;
                delete draft.textures;
                delete draft.animation;
            }
            emit();
        });
        const list = document.createElement("datalist");
        list.id = `editor-assets-${++nextListId}`;
        field.setAttribute("list", list.id);
        container.append(list);
        void getObjectList(draft.type).then(values => {
            if (active) list.replaceChildren(...values.map(value => option(value, value)));
        }).catch(() => { if (active) field.title = "Asset suggestions could not load. You can still enter an ID."; });
    }

    if (draft.type === "skin") {
        const skin = draft;
        const source = section(container, "Skin");
        const field = text(source, "Player name, UUID, or PNG URL", skin.skin ?? "");
        field.addEventListener("change", () => { skin.skin = field.value.trim() || undefined; emit(); });
        png(source, "Import skin PNG", value => { skin.skin = value; emit(); }, fail);
        select(source, "Arms", [["auto", "Detect"], ["false", "Classic"], ["true", "Slim"]], String(skin.options?.slim ?? "auto"), value => options({ slim: value === "auto" ? undefined : value === "true" }));
        select(source, "Texture layout", [["auto", "Detect"], ["false", "Modern (64 × 64)"], ["true", "Legacy (64 × 32)"]], String(skin.options?.legacy ?? "auto"), value => options({ legacy: value === "auto" ? undefined : value === "true" }));
        const cape = section(container, "Cape");
        let capeLayout = skin.cape?.layout ?? "minecraft";
        const capeSource = text(cape, "Player name, UUID, or PNG URL", skin.cape?.texture ?? "");
        capeSource.placeholder = "None";
        capeSource.addEventListener("change", () => {
            skin.cape = capeSource.value.trim() ? { texture: capeSource.value.trim(), layout: capeLayout } : undefined;
            emit();
        });
        png(cape, "Import cape PNG", texture => { skin.cape = { texture, layout: capeLayout }; emit(); }, fail);
        select(cape, "Layout", [["minecraft", "Minecraft"], ["optifine", "OptiFine"], ["labymod", "LabyMod"]], capeLayout, value => {
            capeLayout = value as typeof capeLayout;
            if (skin.cape) { skin.cape.layout = capeLayout; emit(); }
        });
        button(cape, "Remove cape", () => { delete skin.cape; emit(); });
        const labels = {
            head: "Head", body: "Body", rightArm: "Right arm", leftArm: "Left arm", rightLeg: "Right leg", leftLeg: "Left leg",
            hat: "Hat", jacket: "Jacket", rightSleeve: "Right sleeve", leftSleeve: "Left sleeve", rightTrousers: "Right trousers", leftTrousers: "Left trousers", cape: "Cape"
        };
        const pose = document.createElement("details");
        pose.className = "editor-section";
        const poseTitle = document.createElement("summary");
        poseTitle.textContent = "Pose · degrees";
        pose.append(poseTitle);
        container.append(pose);
        note(pose, "The hat, jacket, sleeves, and trousers follow their body parts. Left and right are the player's own.");
        if (!skin.cape) note(pose, "Add a cape to edit its pose.");
        const poseInputs = new Map<SceneSkinPosePart, HTMLInputElement[]>();
        const rotation = (part: SceneSkinPosePart): [number, number, number] => skin.pose?.[part] ?? [part === "cape" ? Math.PI / 30 : 0, 0, 0];
        const syncPose = () => {
            for (const [part, inputs] of poseInputs) {
                const values = rotation(part);
                inputs.forEach((input, axis) => { input.value = String(Number((values[axis] / (Math.PI / 180)).toFixed(3))); });
            }
        };
        const emitPose = () => {
            if (!active) return;
            if (context.onSkinPoseChange) context.onSkinPoseChange(structuredClone(skin.pose));
            else emit();
        };
        const poseParts: SceneSkinPosePart[] = ["head", "body", "rightArm", "leftArm", "rightLeg", "leftLeg", ...(skin.cape ? ["cape" as const] : [])];
        for (const part of poseParts) {
            const group = document.createElement("fieldset");
            const title = document.createElement("legend");
            title.className = "vector-label";
            title.textContent = labels[part];
            const row = document.createElement("div");
            row.className = "transform-vector";
            group.append(title, row);
            pose.append(group);
            const inputs = ["X", "Y", "Z"].map((axis, index) => {
                const input = text(row, axis, "0");
                input.type = "number";
                input.step = "any";
                input.setAttribute("aria-label", `${labels[part]} rotation ${axis} in degrees`);
                input.addEventListener("change", () => {
                    if (!input.value || !Number.isFinite(input.valueAsNumber)) {
                        fail(new Error("Enter a finite number of degrees for the pose."));
                        syncPose();
                        return;
                    }
                    const values: [number, number, number] = [...rotation(part)];
                    values[index] = input.valueAsNumber * (Math.PI / 180);
                    skin.pose = { ...skin.pose, [part]: values };
                    emitPose();
                });
                return input;
            });
            poseInputs.set(part, inputs);
            button(group, "Reset part", () => {
                const next = { ...skin.pose };
                delete next[part];
                skin.pose = Object.keys(next).length ? next : undefined;
                syncPose();
                emitPose();
            }).setAttribute("aria-label", `Reset ${labels[part].toLowerCase()} pose`);
        }
        button(pose, "Reset pose", () => { delete skin.pose; syncPose(); emitPose(); });
        syncPose();
        const parts = section(container, "Visible skin parts");
        for (const [name, label] of Object.entries(labels)) {
            check(parts, label, !skin.hiddenParts?.includes(name), visible => {
                const hidden = skin.hiddenParts?.filter(part => part !== name) ?? [];
                if (!visible) hidden.push(name);
                skin.hiddenParts = hidden;
                emit();
            });
        }
    }

    if (draft.type === "block") {
        const block = draft;
        const states = section(container, "Blockstate properties");
        const status = note(states, "Loading properties…");
        void getBlockProperties(block.asset).then(({ choices, defaults }) => {
            if (!active) return;
            status.textContent = Object.keys(choices).length ? "" : "This block has no state properties.";
            for (const [name, values] of Object.entries(choices)) {
                const value = block.state?.[name] ?? defaults[name] ?? "";
                select(states, name, [...new Set([value, ...values])].map(value => [value, value || "Default"]), value, value => {
                    block.state = { ...block.state };
                    if (value) block.state[name] = value; else delete block.state[name];
                    emit();
                });
            }
            if (Object.keys(choices).length) button(states, "Reset properties", () => { block.state = {}; emit(); });
        }).catch(error => {
            if (active) { status.textContent = "Could not load blockstate properties."; fail(error); }
        });
    }

    if (draft.type === "item" || draft.type === "model") {
        select(container, "Display pose", [["", draft.type === "item" ? "Default (GUI)" : "None"], ...DISPLAY_POSITIONS.map(value => [value, value.replace(/_/g, " ")] as [string, string])], draft.options?.displayPosition ?? "", value => options({ displayPosition: value || undefined }));
    }

    if (draft.type === "block" || draft.type === "item" || draft.type === "model") {
        const object = draft;
        const tints = section(container, "Tint colors");
        note(tints, "Colors apply to model faces with the matching tint index.");
        for (const index of [...new Set([0, ...Object.keys(object.options?.tints ?? {}).map(Number)])]) {
            const color = text(tints, `Tint ${index}`, object.options?.tints?.[index] === undefined ? "" : hex(object.options.tints[index]));
            color.placeholder = "Automatic";
            color.addEventListener("change", () => {
                const value = color.value.trim();
                if (value && !/^#[\da-f]{6}$/i.test(value)) { fail(new Error("Enter a tint as #RRGGBB, or leave it empty for the default.")); return; }
                const values = { ...object.options?.tints };
                if (value) values[index] = parseInt(value.slice(1), 16);
                else delete values[index];
                options({ tints: Object.keys(values).length ? values : undefined });
            });
        }
    }

    if (draft.type === "entity") {
        const entity = draft;
        const drawing = section(container, "Entity layers and states");
        const metadata = note(drawing, "Loading layers…");
        select(drawing, "Model transform", [["auto", "Dataset default"], ["true", "Vanilla flip"], ["false", "Raw model space"]], String(entity.options?.flip ?? "auto"), value => options({ flip: value === "auto" ? undefined : value === "true" }));
        const texture = text(drawing, "First layer texture", entity.texture ?? "");
        texture.placeholder = "Use entity texture";
        texture.addEventListener("change", () => { entity.texture = texture.value.trim() || undefined; emit(); });
        const key = AssetKey.parse("entities", entity.asset);
        const modelData = Promise.all([Entities.getLayerList(key), Entities.getPassList(key)]);
        void modelData.then(([layers, passes]) => {
            if (!active) return;
            metadata.textContent = "Default draws include the main layer and enabled state layers. Custom layers replace those draws.";
            check(drawing, "Use custom layers", entity.layers !== undefined, enabled => {
                entity.layers = enabled ? [layers.includes("main") ? "main" : layers[0]].filter(Boolean) : undefined;
                delete entity.animation;
                emit();
            });
            if (entity.layers) {
                for (const name of layers) check(drawing, name, entity.layers.includes(name), enabled => {
                    const selected = new Set(entity.layers);
                    if (enabled) selected.add(name); else selected.delete(name);
                    if (!selected.size) { fail(new Error("Select at least one entity layer.")); return; }
                    entity.layers = layers.filter(layer => selected.has(layer));
                    delete entity.animation;
                    emit();
                });
            } else {
                for (const name of [...new Set(passes.map(pass => pass.when).filter((name): name is string => name !== undefined))]) {
                    check(drawing, name, entity.when?.includes(name) ?? false, enabled => {
                        const values = entity.when?.filter(value => value !== name) ?? [];
                        if (enabled) values.push(name);
                        entity.when = values;
                        delete entity.animation;
                        emit();
                    });
                }
            }
            const drawn = entity.layers ?? ["main", ...passes.filter(pass => pass.when === undefined || entity.when?.includes(pass.when)).map(pass => pass.layer)];
            const names: string[] = [];
            const textures = section(container, "Layer textures");
            for (const layer of drawn) {
                let name = layer;
                for (let n = 2; names.includes(name); n++) name = `${layer}#${n}`;
                names.push(name);
                const field = text(textures, name, entity.textures?.[name] ?? "");
                field.placeholder = "Use entity texture";
                field.addEventListener("change", () => {
                    const values = { ...entity.textures };
                    if (field.value.trim()) values[name] = field.value.trim(); else delete values[name];
                    entity.textures = Object.keys(values).length ? values : undefined;
                    emit();
                });
            }
            const labels = [...new Set(passes.map(pass => pass.tint).filter((name): name is string => name !== undefined))];
            if (labels.length) {
                const colors = section(container, "Entity tint colors");
                for (const name of labels) {
                    const field = text(colors, name, hex(entity.options?.tints?.[name] ?? 0xffffff));
                    field.type = "color";
                    field.addEventListener("change", () => options({ tints: { ...entity.options?.tints, [name]: field.value } }));
                }
            }
        }).catch(error => {
            if (active) { metadata.textContent = "Could not load entity layers."; fail(error); }
        });
        const animation = section(container, "Animation");
        const animationStatus = note(animation, "Loading animations…");
        void Promise.all([Entities.getAnimations(key), modelData.catch(() => [[], []] as const)]).then(([clips, [, passes]]) => {
            if (!active) return;
            const entries = Object.entries(clips ?? {});
            animationStatus.textContent = entries.length ? "" : "This entity has no available animation clips.";
            if (!entries.length) return;
            const drawn = entity.layers ?? ["main", ...passes.filter(pass => pass.when === undefined || entity.when?.includes(pass.when)).map(pass => pass.layer)];
            const picker = select(animation, "Clip", [["", "None"], ...entries.map(([name, clip]) => [name, `${name} (${clip.layer ?? "main"})`] as [string, string])], entity.animation?.name ?? "", name => {
                entity.animation = name ? { name, loop: clips![name].loop, speed: 1, time: 0 } : undefined;
                emit();
            });
            for (const entry of Array.from(picker.options)) {
                const clip = clips?.[entry.value];
                if (clip && !drawn.includes(clip.layer ?? "main")) {
                    entry.disabled = true;
                    entry.title = `Enable the ${clip.layer ?? "main"} layer to play this clip.`;
                }
            }
            if (!entity.animation) return;
            const clip = clips?.[entity.animation.name];
            const keepTime = () => { entity.animation!.time = context.getAnimationTime?.() ?? entity.animation!.time ?? 0; };
            check(animation, "Loop", entity.animation.loop ?? clip?.loop ?? false, loop => { keepTime(); entity.animation!.loop = loop; emit(); });
            number(animation, "Speed", entity.animation.speed ?? 1, 0, undefined, 0.1, speed => { keepTime(); entity.animation!.speed = speed; emit(); });
            const time = context.getAnimationTime?.() ?? entity.animation.time ?? 0;
            const displayedTime = clip?.length ? (entity.animation.loop ?? clip.loop) ? time % clip.length : Math.min(time, clip.length) : time;
            number(animation, "Time (seconds)", displayedTime, 0, clip?.length, 0.05, time => { entity.animation!.time = time; entity.animation!.paused = true; emit(); });
            const row = document.createElement("div");
            row.className = "editor-row";
            animation.append(row);
            button(row, entity.animation.paused ? "Play" : "Pause", () => { keepTime(); entity.animation!.paused = !entity.animation!.paused; emit(); });
            button(row, "Restart", () => { entity.animation!.time = 0; entity.animation!.paused = false; emit(); });
            button(row, "Stop", () => { delete entity.animation; emit(); });
            if (clip) note(animation, `Clip duration: ${clip.length.toFixed(2)} seconds. Set time to pause at a frame.`);
        }).catch(error => {
            if (active) { animationStatus.textContent = "Could not load animation clips."; fail(error); }
        });
    }

    if (draft.type === "gui") {
        const gui = draft;
        const layers = section(container, "GUI layers");
        note(layers, "Layers draw in order. Use texture, item, or text with positions in GUI pixels.");
        json(layers, "Layers JSON", gui.layers, value => {
            if (!Array.isArray(value)) throw new Error("GUI layers must be an array.");
            gui.layers = value;
            emit();
        }, fail);
    }

    if (draft.type !== "skin" && draft.type !== "gui") {
        check(container, "Wireframe", draft.options?.wireframe ?? false, wireframe => options({ wireframe }));
    }
    if (draft.type !== "gui") {
        const advanced = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "Advanced object options";
        advanced.append(summary);
        container.append(advanced);
        json(advanced, "Options JSON", draft.options ?? {}, value => {
            if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Object options must be a JSON object.");
            draft.options = value;
            emit();
        }, fail);
    }
    return () => { active = false; };
}

function section(parent: HTMLElement, title: string): HTMLFieldSetElement {
    const group = document.createElement("fieldset");
    group.className = "editor-section";
    const legend = document.createElement("legend");
    legend.textContent = title;
    group.append(legend);
    parent.append(group);
    return group;
}

function note(parent: HTMLElement, message: string): HTMLParagraphElement {
    const element = document.createElement("p");
    element.className = "editor-note";
    element.textContent = message;
    parent.append(element);
    return element;
}

function field(parent: HTMLElement, title: string, control: HTMLElement) {
    const label = document.createElement("label");
    label.className = "editor-field";
    const caption = document.createElement("span");
    caption.textContent = title;
    label.append(caption, control);
    parent.append(label);
}

function text(parent: HTMLElement, title: string, value: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value;
    input.autocomplete = "off";
    field(parent, title, input);
    return input;
}

function option(value: string, title: string): HTMLOptionElement {
    const entry = document.createElement("option");
    entry.value = value;
    entry.textContent = title;
    return entry;
}

function select(parent: HTMLElement, title: string, choices: [string, string][], value: string, change: (value: string) => void) {
    const input = document.createElement("select");
    input.append(...choices.map(([value, label]) => option(value, label)));
    input.value = value;
    input.addEventListener("change", () => change(input.value));
    field(parent, title, input);
    return input;
}

function check(parent: HTMLElement, title: string, value: boolean, change: (value: boolean) => void) {
    const label = document.createElement("label");
    label.className = "editor-check";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = value;
    input.addEventListener("change", () => change(input.checked));
    label.append(input, document.createTextNode(title));
    parent.append(label);
}

function number(parent: HTMLElement, title: string, value: number, min: number, max: number | undefined, step: number, change: (value: number) => void) {
    const input = text(parent, title, String(value));
    input.type = "number";
    input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.step = String(step);
    input.addEventListener("change", () => {
        if (!input.value || !Number.isFinite(input.valueAsNumber) || !input.checkValidity()) { input.reportValidity(); return; }
        change(input.valueAsNumber);
    });
}

function button(parent: HTMLElement, title: string, action: () => void) {
    const control = document.createElement("button");
    control.type = "button";
    control.textContent = title;
    control.addEventListener("click", action);
    parent.append(control);
    return control;
}

function json(parent: HTMLElement, title: string, value: unknown, apply: (value: any) => void, fail: (error: unknown) => void) {
    const input = document.createElement("textarea");
    input.className = "editor-json";
    input.spellcheck = false;
    input.rows = 8;
    input.value = JSON.stringify(value, null, 2);
    field(parent, title, input);
    button(parent, "Apply JSON", () => {
        try { apply(JSON.parse(input.value)); } catch (error) { fail(error); }
    });
}

function png(parent: HTMLElement, title: string, apply: (value: string) => void, fail: (error: unknown) => void) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,.png";
    field(parent, title, input);
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onerror = () => fail(reader.error ?? new Error("Could not read the PNG file."));
        reader.onload = () => apply(String(reader.result));
        reader.readAsDataURL(file);
    });
}

function hex(value: string | number): string {
    return `#${new Color(value).getHexString()}`;
}
