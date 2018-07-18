/**
 * Definition of positions/UV mappings ov Minecraft GUI assets
 */
const guiPositions = {
    bars: {
        pink_empty: {
            uv: [0, 0, 182, 5]
        },
        pink_full: {
            uv: [0, 5, 182, 10]
        },
        cyan_empty: {
            uv: [0, 10, 182, 15]
        },
        cyan_full: {
            uv: [0, 15, 182, 20]
        },
        orange_empty: {
            uv: [0, 20, 182, 25]
        },
        orange_full: {
            uv: [0, 25, 182, 30]
        },
        green_empty: {
            uv: [0, 30, 182, 35]
        },
        green_full: {
            uv: [0, 35, 182, 40]
        },
        yellow_empty: {
            uv: [0, 40, 182, 45]
        },
        yellow_full: {
            uv: [0, 45, 182, 50]
        },
        purple_empty: {
            uv: [0, 50, 182, 55]
        },
        purple_full: {
            uv: [0, 55, 182, 60]
        },
        white_empty: {
            uv: [0, 60, 182, 65]
        },
        white_full: {
            uv: [0, 65, 182, 70]
        }
    },
    book: {
        base: {
            uv: [0, 0, 192, 192],// 192 is actually bigger than the book background, but that's the coordinates MC itself uses
        },
        button_next: {
            uv: [0, 192, 23, 205],
            pos: [120, 156]
        },
        button_next_hover: {
            uv: [23, 192, 46, 205],
            pos: [120, 156]
        },
        button_prev: {
            uv: [0, 205, 23, 218],
            pos: [38, 156]
        },
        button_prev_hover: {
            uv: [23, 205, 46, 218],
            pos: [38, 156]
        }
    },
    container: {
        generic_54: {
            uv: [0, 0, 176, 222],
            top_origin: [8, 18],
            item_offset: [18, 18]
        },
        crafting_table: {
            uv: [0, 0, 176, 166],
            left_origin: [30, 17],
            right_origin: [124, 35],
            item_offset: [18, 18]
        }
    }
};

export default guiPositions;