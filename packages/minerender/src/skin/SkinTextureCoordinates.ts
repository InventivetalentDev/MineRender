import { SkinPart } from "./SkinPart";
import { ModelFaces } from "../model/ModelElement";


export type SkinTextureCoordinates = Record<SkinPart, ModelFaces>;

// The player faces +Z: south is the front, north the back and east the player's left.
// down UVs are flipped on Y - v0 is v1, v1 is v0

const baseSkinCoordinates: SkinTextureCoordinates = {
    head: {
        west: { // left
            uv: [
                0,
                8,
                8,
                16
            ]
        },
        east: { // right
            uv: [
                16,
                8,
                24,
                16
            ]
        },
        south: { // front
            uv: [
                8,
                8,
                16,
                16
            ]
        },
        north: { // back
            uv: [
                24,
                8,
                32,
                16
            ]
        },
        up: { // top
            uv: [
                8,
                0,
                16,
                8
            ]
        },
        down: { // bottom
            uv: [
                16,
                8,
                24,
                0
            ]
        }
    },
    body: {
        west: {
            uv: [
                16,
                20,
                20,
                32
            ]
        },
        east: {
            uv: [
                28,
                20,
                32,
                32
            ]
        },
        south: {
            uv: [
                20,
                20,
                28,
                32
            ]
        },
        north: {
            uv: [
                32,
                20,
                40,
                32
            ]
        },
        up: {
            uv: [
                20,
                16,
                28,
                20
            ]
        },
        down: {
            uv: [
                28,
                20,
                36,
                16
            ]
        }
    },
    leftArm: {
        west: {
            uv: [
                32,
                52,
                36,
                64
            ]
        },
        east: {
            uv: [
                40,
                52,
                44,
                64
            ]
        },
        south: {
            uv: [
                36,
                52,
                40,
                64
            ]
        },
        north: {
            uv: [
                44,
                52,
                48,
                64
            ]
        },
        up: {
            uv: [
                36,
                48,
                40,
                52
            ]
        },
        down: {
            uv: [
                40,
                52,
                44,
                48
            ]
        }
    },
    rightArm: {
        west: {
            uv: [
                40,
                20,
                44,
                32
            ],

        },
        east: {
            uv: [
                48,
                20,
                52,
                32
            ],

        },
        south: {
            uv: [
                44,
                20,
                48,
                32
            ],

        },
        north: {
            uv: [
                52,
                20,
                56,
                32
            ],

        },
        up: {
            uv: [
                44,
                16,
                48,
                20
            ],

        },
        down: {
            uv: [
                48,
                20,
                52,
                16
            ],


        }
    },
    leftLeg: {
        west: {
            uv: [
                16,
                52,
                20,
                64
            ]
        },
        east: {
            uv: [
                24,
                52,
                28,
                64
            ]
        },
        south: {
            uv: [
                20,
                52,
                24,
                64
            ]
        },
        north: {
            uv: [
                28,
                52,
                32,
                64
            ]
        },
        up: {
            uv: [
                20,
                48,
                24,
                52
            ]
        },
        down: {
            uv: [
                24,
                52,
                28,
                48
            ],
            rotation: 180
        }
    },
    rightLeg: {
        west: {
            uv: [
                0,
                20,
                4,
                32
            ],

        },
        east: {
            uv: [
                8,
                20,
                12,
                32
            ]
        },
        south: {
            uv: [
                4,
                20,
                8,
                32
            ],

        },
        north: {
            uv: [
                12,
                20,
                16,
                32
            ],

        },
        up: {
            uv: [
                4,
                16,
                8,
                20
            ],

        },
        down: {
            uv: [
                8,
                20,
                12,
                16
            ],


        }
    },
    hat: {
        west: {
            uv: [
                32,
                8,
                40,
                16
            ]
        },
        east: {
            uv: [
                48,
                8,
                56,
                16
            ]
        },
        south: {
            uv: [
                40,
                8,
                48,
                16
            ]
        },
        north: {
            uv: [
                56,
                8,
                64,
                16
            ]
        },
        up: {
            uv: [
                40,
                0,
                48,
                8
            ]
        },
        down: {
            uv: [
                48,
                8,
                56,
                0
            ],
            rotation: 180
        }
    },
    jacket: {
        west: {
            uv: [
                16,
                36,
                20,
                48
            ]
        },
        east: {
            uv: [
                28,
                36,
                32,
                48
            ]
        },
        south: {
            uv: [
                20,
                36,
                28,
                48
            ]
        },
        north: {
            uv: [
                32,
                36,
                40,
                48
            ]
        },
        up: {
            uv: [
                20,
                32,
                28,
                36
            ]
        },
        down: {
            uv: [
                28,
                36,
                36,
                32
            ],
            rotation: 180
        }
    },
    leftSleeve: {
        west: {
            uv: [
                48,
                52,
                52,
                64
            ]
        },
        east: {
            uv: [
                56,
                52,
                60,
                64
            ]
        },
        south: {
            uv: [
                52,
                52,
                56,
                64
            ]
        },
        north: {
            uv: [
                60,
                52,
                64,
                64
            ]
        },
        up: {
            uv: [
                52,
                48,
                56,
                52
            ]
        },
        down: {
            uv: [
                56,
                52,
                60,
                48
            ],
            rotation: 180
        }
    },
    rightSleeve: {
        west: {
            uv: [
                40,
                36,
                44,
                48
            ]
        },
        east: {
            uv: [
                48,
                36,
                52,
                48
            ]
        },
        south: {
            uv: [
                44,
                36,
                48,
                48
            ]
        },
        north: {
            uv: [
                52,
                36,
                56,
                48
            ]
        },
        up: {
            uv: [
                44,
                32,
                48,
                36
            ]
        },
        down: {
            uv: [
                48,
                36,
                52,
                32
            ],
            rotation: 180
        }
    },
    leftTrousers: {
        west: {
            uv: [
                0,
                52,
                4,
                64
            ]
        },
        east: {
            uv: [
                8,
                52,
                12,
                64
            ]
        },
        south: {
            uv: [
                4,
                52,
                8,
                64
            ]
        },
        north: {
            uv: [
                12,
                52,
                16,
                64
            ]
        },
        up: {
            uv: [
                4,
                48,
                8,
                52
            ]
        },
        down: {
            uv: [
                8,
                52,
                12,
                48
            ]
        }
    },
    rightTrousers: {
        west: {
            uv: [
                0,
                36,
                4,
                48
            ]
        },
        east: {
            uv: [
                8,
                36,
                12,
                48
            ]
        },
        south: {
            uv: [
                4,
                36,
                8,
                48
            ]
        },
        north: {
            uv: [
                12,
                36,
                16,
                48
            ]
        },
        up: {
            uv: [
                4,
                32,
                8,
                36
            ]
        },
        down: {
            uv: [
                8,
                36,
                12,
                32
            ],
            rotation: 180
        }
    },
    cape: {
        east: { uv: [0, 1, 1, 17] },
        west: { uv: [11, 1, 12, 17] },
        north: { uv: [1, 1, 11, 17] },
        south: { uv: [12, 1, 22, 17] },
        up: { uv: [11, 1, 1, 0] },
        down: { uv: [21, 0, 11, 1] }
    }
}


export const classicSkinTextureCoordinates: Readonly<SkinTextureCoordinates> = {
    ...baseSkinCoordinates
};

export const slimSkinTextureCoordinates: Readonly<SkinTextureCoordinates> = {
    ...baseSkinCoordinates,
    leftArm: {
        ...baseSkinCoordinates.leftArm,
        east: { uv: [39, 52, 43, 64] },
        south: { uv: [36, 52, 39, 64] },
        north: { uv: [43, 52, 46, 64] },
        up: { uv: [36, 48, 39, 52] },
        down: { uv: [39, 52, 42, 48] }
    },
    rightArm: {
        ...baseSkinCoordinates.rightArm,
        east: { uv: [47, 20, 51, 32] },
        south: { uv: [44, 20, 47, 32] },
        north: { uv: [51, 20, 54, 32] },
        up: { uv: [44, 16, 47, 20] },
        down: { uv: [47, 20, 50, 16] }
    },
    leftSleeve: {
        ...baseSkinCoordinates.leftSleeve,
        east: { uv: [55, 52, 59, 64] },
        south: { uv: [52, 52, 55, 64] },
        north: { uv: [59, 52, 62, 64] },
        up: { uv: [52, 48, 55, 52] },
        down: { uv: [55, 52, 58, 48], rotation: 180 }
    },
    rightSleeve: {
        ...baseSkinCoordinates.rightSleeve,
        east: { uv: [47, 36, 51, 48] },
        south: { uv: [44, 36, 47, 48] },
        north: { uv: [51, 36, 54, 48] },
        up: { uv: [44, 32, 47, 36] },
        down: { uv: [47, 36, 50, 32], rotation: 180 }
    }
};
