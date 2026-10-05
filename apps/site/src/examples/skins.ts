import { Renderer, SkinObject, Skins } from "minerender";
import type { Example, ExampleGroup } from "./types";
import { ESM_RENDERER, STEVE_TEXTURE, esmRenderer, scriptSnippet, textControl, toggleControl } from "./shared";

const SKIN_RENDERER = {
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

const textureUrl: Example = {
    id: "skin-texture",
    title: "From a texture URL",
    description: "Point the skin at any 64×64 skin texture. Drag to orbit, scroll to zoom.",
    renderer: SKIN_RENDERER,
    placeholder: "/placeholder-skin.png",
    async setup({ renderer }) {
        await renderer.scene.addSkin(STEVE_TEXTURE);
    },
    code: {
        esm: `${ESM_RENDERER}

const skin = await renderer.scene.addSkin(
    "${STEVE_TEXTURE}"
);`,
        script: scriptSnippet(`renderer.scene.addSkin(
    "${STEVE_TEXTURE}"
);`)
    }
};

const byName: Example = {
    id: "skin-name",
    title: "By username or UUID",
    description: "Skins.fromUuidOrUsername resolves a player to their current skin texture through a CORS-safe proxy.",
    renderer: SKIN_RENDERER,
    placeholder: "/placeholder-skin.png",
    async setup(context) {
        const { renderer, signal } = context;
        // Start with a known texture so a failed lookup still shows a player.
        const skin = await renderer.scene.addSkin(STEVE_TEXTURE);
        const status = document.createElement("span");
        status.className = "viewport-control viewport-status";
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
                skin.setSkinTexture(url);
                status.textContent = "";
                renderer.dirty = true;
            } else {
                status.textContent = `Could not resolve "${name}"; showing the previous skin.`;
            }
        };
        textControl(context, "Player", "inventivetalent", value => void apply(value));
        context.controls.appendChild(status);
        await apply("inventivetalent");
    },
    code: {
        esm: `${esmRenderer("Skins")}

const skin = await renderer.scene.addSkin();
const texture = await Skins.fromUuidOrUsername("inventivetalent");
if (texture) skin.setSkinTexture(texture);`,
        script: scriptSnippet(`renderer.scene.addSkin().then(async skin => {
    const texture = await MineRender.Skins.fromUuidOrUsername("inventivetalent");
    if (texture) skin.setSkinTexture(texture);
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
    description: "Groups are plain three.js Object3Ds. Rotate them to pose the player, then mark the renderer dirty.",
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

function pose(skin: SkinObject): void {
    skin.getGroupByName("head")?.rotation.set(-0.2, 0.4, 0);
    skin.getGroupByName("rightArm")?.rotation.set(-2.6, 0, -0.2);
    skin.getGroupByName("leftArm")?.rotation.set(0.5, 0, 0.1);
    skin.getGroupByName("rightLeg")?.rotation.set(0.5, 0, 0);
    skin.getGroupByName("leftLeg")?.rotation.set(-0.5, 0, 0);
}

export const skins: ExampleGroup = {
    id: "skins",
    title: "Skins",
    lead: "Player skins from a texture URL, a username, or a UUID, with named parts you can hide and pose.",
    examples: [textureUrl, byName, layers, posed],
    notes: [
        "Slim-arm (Alex) UV mapping, capes, and legacy 64×32 textures are still in progress in V2.",
    ]
};

export type { Renderer };
