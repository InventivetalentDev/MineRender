import { DYE_COLORS } from "minerender";
import { button, group, note, select } from "../../playground/controls";

interface PatternState {
    item: string;
    components: Record<string, unknown>;
}

const title = (id: string) => id.replace(/^minecraft:/, "").replace(/_/g, " ").replace(/^./, letter => letter.toUpperCase());
const dyes = Object.keys(DYE_COLORS);
const dyeOptions: Array<[string, string]> = dyes.map(dye => [dye, title(dye)]);
const itemId = (item: string) => item.includes(":") ? item : `minecraft:${item}`;
const bannerDye = (item: string) => dyes.find(dye => itemId(item) === `minecraft:${dye}_banner`);
const componentId = (components: Record<string, unknown>, name: string) => Object.prototype.hasOwnProperty.call(components, name) ? name : `minecraft:${name}`;

export function hasBannerControls(state: PatternState): boolean {
    return !!bannerDye(state.item) || itemId(state.item) === "minecraft:shield"
        || ["banner_patterns", "base_color"].some(name => Object.prototype.hasOwnProperty.call(state.components, componentId(state.components, name)));
}

export function bannerControls(parent: HTMLElement, current: () => PatternState, update: (patch: Partial<PatternState>) => void) {
    const controls = group(parent, "Banner and shield patterns");
    controls.hidden = true;
    const content = document.createElement("div");
    controls.append(content);
    let displayed: PatternState;
    const isCurrent = () => !controls.disabled && displayed && current().item === displayed.item
        && JSON.stringify(current().components) === JSON.stringify(displayed.components);
    const apply = (patch: Partial<PatternState>) => {
        if (!isCurrent()) return;
        controls.disabled = true;
        update(patch);
    };

    const editComponents = (edit: (components: Record<string, unknown>) => void) => {
        if (!isCurrent()) return;
        const components = current().components;
        if (!components || typeof components !== "object" || Array.isArray(components)) return;
        const next = structuredClone(components);
        edit(next);
        apply({ components: next });
    };
    const editLayers = (edit: (layers: Array<Record<string, unknown>>) => void, create = false) => editComponents(components => {
        const id = componentId(components, "banner_patterns");
        if (!Array.isArray(components[id]) && !(create && components[id] === undefined)) return;
        const layers = (components[id] ?? []) as Array<Record<string, unknown>>;
        edit(layers);
        components[id] = layers;
    });
    const dyeSelect = (parent: HTMLElement, label: string, value: string, plain = false) => {
        const control = select(parent, label, [...(plain ? [["", "No base color"] as [string, string]] : []), ...dyeOptions], value);
        const swatch = document.createElement("span");
        swatch.setAttribute("aria-hidden", "true");
        Object.assign(swatch.style, { display: "inline-block", width: "1em", height: "1em", marginLeft: "8px", verticalAlign: "middle", border: "1px solid #586575" });
        const color = DYE_COLORS[value as keyof typeof DYE_COLORS];
        swatch.style.backgroundColor = color === undefined ? "transparent" : `#${color.toString(16).padStart(6, "0")}`;
        control.parentElement!.querySelector("span")!.append(swatch);
        return control;
    };

    return (state: PatternState, patterns: string[]) => {
        controls.disabled = false;
        displayed = state;
        controls.hidden = !hasBannerControls(state);
        content.replaceChildren();
        if (controls.hidden) return;
        const dye = bannerDye(state.item);
        if (dye) {
            const base = dyeSelect(content, "Banner base color", dye);
            base.id = "item-banner-base";
            base.addEventListener("change", () => apply({ item: `minecraft:${base.value}_banner` }));
        }
        const baseId = componentId(state.components, "base_color");
        if (itemId(state.item) === "minecraft:shield" || Object.prototype.hasOwnProperty.call(state.components, baseId)) {
            const base = dyeSelect(content, "Shield base color", String(state.components[baseId] ?? ""), true);
            base.id = "item-shield-base";
            base.addEventListener("change", () => editComponents(components => {
                const id = componentId(components, "base_color");
                if (base.value) components[id] = base.value;
                else delete components[id];
            }));
        }
        const layers = state.components[componentId(state.components, "banner_patterns")];
        if (Array.isArray(layers)) layers.forEach((layer: unknown, index) => {
            if (!layer || typeof layer !== "object" || Array.isArray(layer)) return;
            const entry = layer as Record<string, unknown>;
            const row = group(content, `Layer ${index + 1}`);
            row.dataset.bannerLayer = String(index);
            const selected = typeof entry.pattern === "string" ? entry.pattern : "__custom__";
            const options: Array<[string, string]> = patterns.map(id => [id, title(id)]);
            if (!patterns.includes(selected)) options.unshift([selected, selected === "__custom__" ? "Custom pattern" : title(selected)]);
            const pattern = select(row, "Pattern", options, selected);
            pattern.dataset.bannerPattern = String(index);
            pattern.addEventListener("change", () => editLayers(layers => {
                const layer = layers[index];
                if (layer && typeof layer === "object" && !Array.isArray(layer) && pattern.value !== "__custom__") layer.pattern = pattern.value;
            }));
            const color = dyeSelect(row, "Dye color", String(entry.color ?? ""));
            color.dataset.bannerColor = String(index);
            color.addEventListener("change", () => editLayers(layers => {
                const layer = layers[index];
                if (layer && typeof layer === "object" && !Array.isArray(layer)) layer.color = color.value;
            }));
            button(row, "Move up", () => editLayers(layers => {
                if (index > 0 && index < layers.length) [layers[index - 1], layers[index]] = [layers[index], layers[index - 1]];
            })).disabled = index === 0;
            button(row, "Move down", () => editLayers(layers => {
                if (index + 1 < layers.length) [layers[index], layers[index + 1]] = [layers[index + 1], layers[index]];
            })).disabled = index === layers.length - 1;
            button(row, "Remove layer", () => editLayers(layers => { layers.splice(index, 1); }));
        });
        button(content, "Add layer", () => editLayers(layers => { layers.push({ pattern: "minecraft:stripe_bottom", color: "white" }); }, true));
        note(content, "Later layers cover earlier ones.");
        if (Array.isArray(layers) && layers.length > 16) note(content, "Only the first 16 layers render.");
    };
}
