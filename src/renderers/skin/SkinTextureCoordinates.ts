import { SkinPart } from "./SkinPart";
import { ModelFaces } from "../../model/ModelElement";


export type SkinTextureCoordinates = Record<SkinPart, ModelFaces>;

const baseSkinCoordinates: SkinTextureCoordinates = {
    head: {
        west: {
            uv: [
                0,
                8,
                8,
                16
            ]
        },
        east: {
            uv: [
                16,
                8,
                24,
                16
            ]
        },
        north: {
            uv: [
                8,
                8,
                16,
                16
            ]
        },
        south: {
            uv: [
                24,
                8,
                32,
                16
            ]
        },
        up: {
            uv: [
                8,
                0,
                16,
                8
            ]
        },
        down: {
            uv: [
                16,
                0,
                24,
                8
            ],
            rotation: 180
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
                20,
                16,
                28,
                20
            ]
        },
        down: {
            uv: [
                28,
                16,
                36,
                20
            ],
            rotation: 180
        }
    },
    rightArm: {
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
                36,
                48,
                40,
                52
            ]
        },
        down: {
            uv: [
                40,
                48,
                44,
                52
            ],
            rotation: 180
        }
    },
    leftArm: {
        west: {
            uv: [
                40,
                20,
                44,
                32
            ]
        },
        east: {
            uv: [
                48,
                20,
                52,
                32
            ]
        },
        north: {
            uv: [
                44,
                20,
                48,
                32
            ]
        },
        south: {
            uv: [
                52,
                20,
                56,
                32
            ]
        },
        up: {
            uv: [
                44,
                16,
                48,
                20
            ]
        },
        down: {
            uv: [
                48,
                16,
                52,
                20
            ],
            rotation: 180
        }
    },
    rightLeg: {
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
                20,
                48,
                24,
                52
            ]
        },
        down: {
            uv: [
                24,
                48,
                28,
                52
            ],
            rotation: 180
        }
    },
    leftLeg: {
        west: {
            uv: [
                0,
                20,
                4,
                32
            ]
        },
        east: {
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
            ]
        },
        south: {
            uv: [
                12,
                20,
                16,
                32
            ]
        },
        up: {
            uv: [
                4,
                16,
                8,
                20
            ]
        },
        down: {
            uv: [
                8,
                16,
                12,
                20
            ],
            rotation: 180
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
                40,
                0,
                48,
                8
            ]
        },
        down: {
            uv: [
                48,
                0,
                56,
                8
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
                20,
                32,
                28,
                36
            ]
        },
        down: {
            uv: [
                28,
                32,
                36,
                36
            ],
            rotation: 180
        }
    },
    rightSleeve: {
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
                52,
                48,
                56,
                52
            ]
        },
        down: {
            uv: [
                56,
                48,
                60,
                52
            ],
            rotation: 180
        }
    },
    leftSleeve: {
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
                44,
                32,
                48,
                36
            ]
        },
        down: {
            uv: [
                48,
                32,
                52,
                36
            ],
            rotation: 180
        }
    },
    rightTrousers: {
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
                4,
                48,
                8,
                52
            ]
        },
        down: {
            uv: [
                8,
                48,
                12,
                52
            ],
            rotation: 180
        }
    },
    leftTrousers: {
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
    },
    cape: {//TODO
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
        east: {
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
        east: {
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
        east: {
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
        east: {
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
