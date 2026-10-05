/**
 * Pixel icons for the feature list, drawn on an 8×8 grid like a Minecraft texture.
 * Each string row is 8 characters: "." is empty, letters map to the palette below.
 */
const PALETTE: Record<string, string> = {
    g: "var(--moss)",
    l: "var(--sprout)",
    d: "var(--loam)",
    k: "var(--ink)",
    s: "var(--stone-deep)",
    w: "var(--paper)"
};

const ICONS: Record<string, string[]> = {
    scene: [
        "........",
        "..kkkk..",
        ".kllgk..",
        ".kgggkk.",
        ".kdddkd.",
        "..kkkkd.",
        "..d..kd.",
        "........"
    ],
    node: [
        "........",
        ".kkkkkk.",
        ".kwwwwk.",
        ".kwggwk.",
        ".kwwwwk.",
        ".kkkkkk.",
        "...kk...",
        ".kkkkkk."
    ],
    dirty: [
        "........",
        "..gg....",
        ".g..g...",
        "g....g..",
        "g....gkk",
        ".g..g.k.",
        "..gg..k.",
        "........"
    ],
    instanced: [
        "gg.gg.gg",
        "gg.gg.gg",
        "........",
        "gg.gg.gg",
        "gg.gg.gg",
        "........",
        "gg.gg.gg",
        "gg.gg.gg"
    ],
    sources: [
        "........",
        ".dddddd.",
        ".dssssd.",
        ".dddddd.",
        ".dggggd.",
        ".dddddd.",
        ".dllld..",
        "........"
    ],
    versions: [
        "........",
        ".kk..kk.",
        ".kk..kk.",
        "........",
        "..kkkk..",
        ".k....k.",
        "........",
        "........"
    ],
    types: [
        "........",
        ".kkkkkk.",
        ".k....k.",
        ".k.gg.k.",
        ".k.gg.k.",
        ".k....k.",
        ".kkkkkk.",
        "........"
    ],
    world: [
        "....gg..",
        "..ggllg.",
        ".glllggg",
        ".gggddg.",
        "..ddsd..",
        "..dsss..",
        "...ss...",
        "........"
    ],
    skin: [
        "...dd...",
        "...ww...",
        "..llll..",
        ".w.ll.w.",
        "...ll...",
        "..kkkk..",
        "..k..k..",
        "........"
    ],
    tint: [
        "........",
        ".lllggg.",
        ".lllggg.",
        ".lllggg.",
        ".dddsss.",
        ".dddsss.",
        ".dddsss.",
        "........"
    ]
};

export function pixelIcon(name: string, size = 48): string {
    const rows = ICONS[name];
    if (!rows) return "";
    const cells = rows.flatMap((row, y) => Array.from(row).map((char, x) => {
        const fill = PALETTE[char];
        return fill ? `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>` : "";
    })).join("");
    return `<svg class="pixel-icon" width="${size}" height="${size}" viewBox="0 0 8 8" shape-rendering="crispEdges" aria-hidden="true">${cells}</svg>`;
}

export function renderPixelIcons(root: ParentNode = document): void {
    root.querySelectorAll<HTMLElement>("[data-icon]").forEach(element => {
        element.innerHTML = pixelIcon(element.dataset.icon ?? "", Number(element.dataset.size ?? 48));
    });
}
