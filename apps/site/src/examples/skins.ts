import { CapeLayout, SkinObject, Skins } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { ALEX_TEXTURE, ESM_RENDERER, STEVE_TEXTURE, esmRenderer, scriptSnippet, selectControl, statusControl, textControl, toggleControl } from "./shared";

export const SKIN_RENDERER = {
    camera: {
        position: [30, 26, 55] as [number, number, number],
        lookingAt: [0, 16, 0] as [number, number, number]
    }
};

const OVERLAY_PARTS = ["hat", "jacket", "leftSleeve", "rightSleeve", "leftTrousers", "rightTrousers"];

async function resolveSkin(input: string): Promise<string | undefined> {
    if (/^https?:\/\//.test(input)) return input;
    return Skins.fromUuidOrUsername(input);
}

export const textureUrl: Example = {
    id: "skin-texture",
    title: "Skin",
    description: "Any 64×64 or legacy 64×32 skin texture. The arm model (classic or slim) is detected from the image.",
    renderer: SKIN_RENDERER,
    placeholder: "/placeholder-skin.png",
    async setup(context) {
        const { renderer } = context;
        const skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        selectControl(context, "Texture", [[STEVE_TEXTURE, "Steve (classic)"], [ALEX_TEXTURE, "Alex (slim)"]], STEVE_TEXTURE, url => {
            skin.setSkinTexture(url).catch(console.warn);
        });
        selectControl(context, "Arms", [["auto", "Detect"], ["classic", "Classic"], ["slim", "Slim"]], "auto", value => {
            skin.setSlim(value === "auto" ? undefined : value === "slim");
            renderer.dirty = true;
        });
    },
    code: {
        esm: `${ESM_RENDERER}

// Slim or classic arms are detected from the texture
const skin = await renderer.scene.addSkin("${ALEX_TEXTURE}");

// Or decide yourself
skin.setSlim(true);
await skin.setSkinTexture("${STEVE_TEXTURE}");`,
        script: scriptSnippet(`renderer.scene.addSkin("${ALEX_TEXTURE}");`)
    }
};

const byName: Example = {
    id: "skin-name",
    title: "By username or UUID",
    description: "Resolves a player to their current skin through a CORS-friendly proxy, then loads it.",
    renderer: SKIN_RENDERER,
    placeholder: "/placeholder-skin.png",
    async setup(context) {
        const { renderer, signal } = context;
        // Start with a known texture so a failed lookup still shows a player.
        const skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        const status = statusControl(context);
        const apply = async (name: string) => {
            if (!name) return;
            status.textContent = `Looking up ${name}…`;
            let url: string | undefined;
            try {
                url = await resolveSkin(name);
            } catch (error) {
                console.warn(error);
            }
            if (signal.aborted) return;
            if (url) {
                await skin.setSkinTexture(url);
                status.textContent = "";
                renderer.dirty = true;
            } else {
                status.textContent = `No skin found for "${name}". Showing the previous one.`;
            }
        };
        textControl(context, "Player", "inventivetalent", value => void apply(value));
        await apply("inventivetalent");
    },
    code: {
        esm: `${esmRenderer("Skins")}

const skin = await renderer.scene.addSkin();
const texture = await Skins.fromUuidOrUsername("inventivetalent");
if (texture) await skin.setSkinTexture(texture);`,
        script: scriptSnippet(`renderer.scene.addSkin().then(async skin => {
    const texture = await MineRender.Skins.fromUuidOrUsername("inventivetalent");
    if (texture) await skin.setSkinTexture(texture);
});`)
    }
};

const layers: Example = {
    id: "skin-layers",
    title: "Toggle overlay layers",
    description: "Every body part is a named group with a named mesh, so the outer layer can be hidden per part.",
    renderer: SKIN_RENDERER,
    placeholder: "/placeholder-skin.png",
    async setup(context) {
        const { renderer } = context;
        const skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        toggleControl(context, "Outer layer", true, visible => {
            for (const part of OVERLAY_PARTS) skin.toggleMeshVisibility(part, visible);
            renderer.dirty = true;
        });
        toggleControl(context, "Head", true, visible => {
            skin.toggleGroupVisibility("head", visible);
            renderer.dirty = true;
        });
    },
    code: {
        esm: `${ESM_RENDERER}

const skin = await renderer.scene.addSkin("${STEVE_TEXTURE}");

// Hide the second layer on the head and body
skin.toggleMeshVisibility("hat", false);
skin.toggleMeshVisibility("jacket", false);

// Groups contain the inner and outer layer of a part
skin.toggleGroupVisibility("leftArm", false);

// Anything that changes visuals needs a redraw
renderer.dirty = true;`
    }
};

const posed: Example = {
    id: "skin-pose",
    title: "Pose individual parts",
    description: "Groups are plain three.js Object3Ds. The player faces +Z, so a negative X rotation raises a limb forward. Rotate the groups, then mark the renderer dirty.",
    renderer: SKIN_RENDERER,
    placeholder: "/placeholder-skin.png",
    async setup({ renderer }) {
        const skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        pose(skin);
        renderer.dirty = true;
    },
    code: {
        esm: `${ESM_RENDERER}

const skin = await renderer.scene.addSkin("${STEVE_TEXTURE}");

skin.getGroupByName("head")!.rotation.set(-0.2, 0.4, 0);
skin.getGroupByName("rightArm")!.rotation.set(-2.6, 0, -0.2);
skin.getGroupByName("leftArm")!.rotation.set(0.5, 0, 0.1);
skin.getGroupByName("rightLeg")!.rotation.set(0.5, 0, 0);
skin.getGroupByName("leftLeg")!.rotation.set(-0.5, 0, 0);

renderer.dirty = true;`
    }
};

const CAPE_LAYOUTS: Array<[CapeLayout, string]> = [["minecraft", "Minecraft"], ["optifine", "OptiFine"], ["labymod", "LabyMod"]];

const cape: Example = {
    id: "skin-cape",
    title: "Capes",
    description: "Vanilla, OptiFine, and LabyMod cape layouts. capes.dev resolves a player's cape; any texture URL works too.",
    renderer: {
        camera: {
            // The player faces +Z, so look at the back
            position: [-30, 26, -55] as [number, number, number],
            lookingAt: [0, 16, 0] as [number, number, number]
        }
    },
    placeholder: "/placeholder-skin.png",
    async setup(context) {
        const { renderer, signal } = context;
        const skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        const status = statusControl(context);
        let player = "jeb_";
        let layout: CapeLayout = "minecraft";
        const apply = async () => {
            status.textContent = `Looking up ${player}…`;
            let src: string | undefined;
            try {
                src = /^https?:\/\//.test(player) ? player : await Skins.capeFromCapesDev(player, layout);
            } catch (error) {
                console.warn(error);
            }
            if (signal.aborted) return;
            if (!src) {
                status.textContent = `No ${layout} cape found for "${player}".`;
                await skin.setCapeTexture(undefined);
                return;
            }
            try {
                await skin.setCapeTexture(src, layout);
                status.textContent = "";
            } catch (error) {
                status.textContent = error instanceof Error ? error.message : "Could not load the cape.";
            }
            renderer.dirty = true;
        };
        textControl(context, "Player", player, value => {
            if (!value) return;
            player = value;
            void apply();
        });
        selectControl(context, "Layout", CAPE_LAYOUTS, layout, value => {
            layout = value as CapeLayout;
            void apply();
        });
        context.controls.appendChild(status);
        await apply();
    },
    code: {
        esm: `${esmRenderer("Skins")}

const skin = await renderer.scene.addSkin("${STEVE_TEXTURE}");

// Look up a player's cape on capes.dev ("minecraft", "optifine" or "labymod")
const cape = await Skins.capeFromCapesDev("jeb_", "minecraft");
if (cape) await skin.setCapeTexture(cape, "minecraft");

// Or load any cape texture directly, and remove it again with undefined
await skin.setCapeTexture("https://example.com/cape.png", "optifine");
await skin.setCapeTexture(undefined);`
    }
};

export function pose(skin: SkinObject): void {
    skin.getGroupByName("head")?.rotation.set(-0.2, 0.4, 0);
    skin.getGroupByName("rightArm")?.rotation.set(-2.6, 0, -0.2);
    skin.getGroupByName("leftArm")?.rotation.set(0.5, 0, 0.1);
    skin.getGroupByName("rightLeg")?.rotation.set(0.5, 0, 0);
    skin.getGroupByName("leftLeg")?.rotation.set(-0.5, 0, 0);
}

export const skins: ExampleGroup = {
    id: "skins",
    title: "Skins",
    lead: "Player skins from a texture or a player name, with classic, slim, and legacy layouts detected automatically, plus capes.",
    examples: [{ ...textureUrl, title: "Classic and slim" }, byName, cape, layers, posed]
};
