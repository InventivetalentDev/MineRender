import { SkinPart } from "./SkinPart";
import { ModelFaces } from "../model/ModelElement";


export type SkinTextureCoordinates = Record<SkinPart, ModelFaces>;

// up and down UVs are weird
//  so they're flipped on X - u0 is u1, u1 is u0
//  up seems to also be flipped on Y - v0 is v1, v1 is v0

const baseSkinCoordinates: SkinTextureCoordinates = {
    head: {
        east: { // left
            uv: [
                0,
                8,
                8,
                16
            ]
        },
        west: { // right
            uv: [
                16,
                8,
                24,
                16
            ]
        },
        north: { // front
            uv: [
                8,
                8,
                16,
                16
            ]
        },
        south: { // back
            uv: [
                24,
                8,
                32,
                16
            ]
        },
        up: { // top
            uv: [
                16,
                8,
                8,
                0
            ]
        },
        down: { // bottom
            uv: [
                24,
                0,
                16,
                8
            ]
        }
    },
    body: {
        east: {
            uv: [
                16,
                20,
                20,
                32
            ]
        },
        west: {
            uv: [
                28,
                20,
                32,
                32
            ]
        },
        north: {
            uv: [
                20,
                20,
                28,
                32
            ]
        },
        south: {
            uv: [
                32,
                20,
                40,
                32
            ]
        },
        up: {
            uv: [
                28,
                20,
                20,
                16
            ]
        },
        down: {
            uv: [
                36,
                16,
                28,
                20
            ]
        }
    },
    leftArm: {
        east: {
            uv: [
                32,
                52,
                36,
                64
            ]
        },
        west: {
            uv: [
                40,
                52,
                44,
                64
            ]
        },
        north: {
            uv: [
                36,
                52,
                40,
                64
            ]
        },
        south: {
            uv: [
                44,
                52,
                48,
                64
            ]
        },
        up: {
            uv: [
                40,
                52,
                36,
                48
            ]
        },
        down: {
            uv: [
                44,
                48,
                40,
                52
            ]
        }
    },
    rightArm: {
        east: {
            uv: [
                40,
                20,
                44,
                32
            ],

        },
        west: {
            uv: [
                48,
                20,
                52,
                32
            ],

        },
        north: {
            uv: [
                44,
                20,
                48,
                32
            ],

        },
        south: {
            uv: [
                52,
                20,
                56,
                32
            ],

        },
        up: {
            uv: [
                48,
                20,
                44,
                16
            ],

        },
        down: {
            uv: [
                52,
                16,
                48,
                20
            ],


        }
    },
    leftLeg: {
        east: {
            uv: [
                16,
                52,
                20,
                64
            ]
        },
        west: {
            uv: [
                24,
                52,
                28,
                64
            ]
        },
        north: {
            uv: [
                20,
                52,
                24,
                64
            ]
        },
        south: {
            uv: [
                28,
                52,
                32,
                64
            ]
        },
        up: {
            uv: [
                24,
                52,
                20,
                48
            ]
        },
        down: {
            uv: [
                28,
                48,
                24,
                52
            ],
            rotation: 180
        }
    },
    rightLeg: {
        east: {
            uv: [
                0,
                20,
                4,
                32
            ],

        },
        west: {
            uv: [
                8,
                20,
                12,
                32
            ]
        },
        north: {
            uv: [
                4,
                20,
                8,
                32
            ],

        },
        south: {
            uv: [
                12,
                20,
                16,
                32
            ],

        },
        up: {
            uv: [
                8,
                20,
                4,
                16
            ],

        },
        down: {
            uv: [
                12,
                16,
                8,
                20
            ],


        }
    },
    hat: {
        east: {
            uv: [
                32,
                8,
                40,
                16
            ]
        },
        west: {
            uv: [
                48,
                8,
                56,
                16
            ]
        },
        north: {
            uv: [
                40,
                8,
                48,
                16
            ]
        },
        south: {
            uv: [
                56,
                8,
                64,
                16
            ]
        },
        up: {
            uv: [
                48,
                8,
                40,
                0
            ]
        },
        down: {
            uv: [
                56,
                0,
                48,
                8
            ],
            rotation: 180
        }
    },
    jacket: {
        east: {
            uv: [
                16,
                36,
                20,
                48
            ]
        },
        west: {
            uv: [
                28,
                36,
                32,
                48
            ]
        },
        north: {
            uv: [
                20,
                36,
                28,
                48
            ]
        },
        south: {
            uv: [
                32,
                36,
                40,
                48
            ]
        },
        up: {
            uv: [
                28,
                36,
                20,
                32
            ]
        },
        down: {
            uv: [
                36,
                32,
                28,
                36
            ],
            rotation: 180
        }
    },
    leftSleeve: {
        east: {
            uv: [
                48,
                52,
                52,
                64
            ]
        },
        west: {
            uv: [
                56,
                52,
                60,
                64
            ]
        },
        north: {
            uv: [
                52,
                52,
                56,
                64
            ]
        },
        south: {
            uv: [
                60,
                52,
                64,
                64
            ]
        },
        up: {
            uv: [
                56,
                52,
                52,
                48
            ]
        },
        down: {
            uv: [
                60,
                48,
                56,
                52
            ],
            rotation: 180
        }
    },
    rightSleeve: {
        east: {
            uv: [
                40,
                36,
                44,
                48
            ]
        },
        west: {
            uv: [
                48,
                36,
                52,
                48
            ]
        },
        north: {
            uv: [
                44,
                36,
                48,
                48
            ]
        },
        south: {
            uv: [
                52,
                36,
                56,
                48
            ]
        },
        up: {
            uv: [
                48,
                36,
                44,
                32
            ]
        },
        down: {
            uv: [
                52,
                32,
                48,
                36
            ],
            rotation: 180
        }
    },
    leftTrousers: {
        east: {
            uv: [
                0,
                52,
                4,
                64
            ]
        },
        west: {
            uv: [
                8,
                52,
                12,
                64
            ]
        },
        north: {
            uv: [
                4,
                52,
                8,
                64
            ]
        },
        south: {
            uv: [
                12,
                52,
                16,
                64
            ]
        },
        up: {
            uv: [
                8,
                52,
                4,
                48
            ]
        },
        down: {
            uv: [
                12,
                48,
                8,
                52
            ]
        }
    },
    rightTrousers: {
        east: {
            uv: [
                0,
                36,
                4,
                48
            ]
        },
        west: {
            uv: [
                8,
                36,
                12,
                48
            ]
        },
        north: {
            uv: [
                4,
                36,
                8,
                48
            ]
        },
        south: {
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
                36,
                8,
                32
            ]
        },
        down: {
            uv: [
                8,
                32,
                12,
                36
            ],
            rotation: 180
        }
    },
    cape: {//TODO
        east: {
            uv: [
                0,
                36,
                4,
                48
            ]
        },
        west: {
            uv: [
                8,
                36,
                12,
                48
            ]
        },
        north: {
            uv: [
                4,
                36,
                8,
                48
            ]
        },
        south: {
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
                32,
                12,
                36
            ],
            rotation: 180
        }
    }
}


export const classicSkinTextureCoordinates: Readonly<SkinTextureCoordinates> = {
    ...baseSkinCoordinates
};

//TODO
export const slimSkinTextureCoordinates: Readonly<SkinTextureCoordinates> = {...baseSkinCoordinates} /*merge(baseSkinCoordinates, <SkinTextureCoordinates>{
    rightArm: {
        west: {
            x: 39
        },
        south: {
            w: 3
        },
        north: {
            x: 43,
            w: 3
        },
        up: {
            w: 3
        },
        down: {
            x: 39,
            w: 3
        }
    },
    leftArm: {
        west: {
            x: 47
        },
        south: {
            w: 3
        },
        north: {
            x: 51,
            w: 3
        },
        up: {
            w: 3
        },
        down: {
            x: 47,
            w: 3
        }
    },

    rightSleeve: {
        west: {
            x: 55
        },
        south: {
            w: 3
        },
        north: {
            x: 59,
            w: 3
        },
        up: {
            w: 3
        },
        down: {
            x: 55,
            w: 3
        }
    },
    leftSleeve: {
        west: {
            x: 47
        },
        south: {
            w: 3
        },
        north: {
            x: 51,
            w: 3
        },
        up: {
            w: 3
        },
        down: {
            x: 47,
            w: 3
        }
    }
});
*/
