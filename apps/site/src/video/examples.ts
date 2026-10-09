import type { Example, ExampleGroup } from "../examples/types";
import { blocks } from "../examples/blocks";
import { entities } from "../examples/entities";
import { exports } from "../examples/exports";
import { guis } from "../examples/gui";
import { items } from "../examples/items";
import { resourcepacks } from "../examples/resourcepacks";
import { composed } from "../examples/scene";
import { skins } from "../examples/skins";
import { structures } from "../examples/structures";
import type { ShotContext } from "./types";

const groups: ExampleGroup[] = [blocks, items, skins, entities, guis, structures, resourcepacks, exports];

/** Looks up a site example by id so shots can reuse its scene setup. */
export function example(id: string): Example {
    if (composed.id === id) return composed;
    for (const group of groups) {
        const found = group.examples.find(entry => entry.id === id);
        if (found) return found;
    }
    throw new Error(`Unknown example "${id}"`);
}

/**
 * Runs an example's setup against the shot renderer. Controls land in a detached element and
 * loading indicators are ignored; the clock is paused on the timeline while this runs.
 */
export async function runExample(context: ShotContext, id: string): Promise<void> {
    const controls = document.createElement("div");
    await example(id).setup({
        renderer: context.renderer,
        signal: context.signal,
        controls,
        track: work => work
    });
}
