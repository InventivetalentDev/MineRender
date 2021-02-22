import { CubeTextureCoordinates, TextureCoordinate, TextureCoordinates } from "../../TextureCoordinates";
import merge from "ts-deepmerge";
import { SkinPart } from "./SkinPart";


export type SkinTextureCoordinates = Record<SkinPart, CubeTextureCoordinates>;

const baseSkinCoordinates: SkinTextureCoordinates = {
    head: {
        west: {
            x: 0,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        east: {
            x: 16,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        south: {
            x: 8,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        north: {
            x: 24,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        up: {
            x: 8,
            y: 0,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        down: {
            x: 16,
            y: 0,
            w: 8,
            h: 8,
            fx: true,
            fy: true
        }
    },
    body: {
        west: {
            x: 16,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 28,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 20,
            y: 20,
            w: 8,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 32,
            y: 20,
            w: 8,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 20,
            y: 16,
            w: 8,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 28,
            y: 16,
            w: 8,
            h: 4,
            fx: true,
            fy: true
        }
    },
    rightArm: { // 64x64 only
        west: {
            x: 32,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 40,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 36,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 44,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 36,
            y: 48,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 40,
            y: 48,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    leftArm: {
        west: {
            x: 40,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 48,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 44,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 52,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 44,
            y: 16,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 48,
            y: 16,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    rightLeg: { // 64x64 only
        west: {
            x: 16,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 24,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 20,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 28,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 20,
            y: 48,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 24,
            y: 48,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    leftLeg: {
        west: {
            x: 0,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 8,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 4,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 12,
            y: 20,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 4,
            y: 16,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 8,
            y: 16,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    hat: {
        west: {
            x: 32,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        east: {
            x: 48,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        south: {
            x: 40,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        north: {
            x: 56,
            y: 8,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        up: {
            x: 40,
            y: 0,
            w: 8,
            h: 8,
            fx: false,
            fy: false
        },
        down: {
            x: 48,
            y: 0,
            w: 8,
            h: 8,
            fx: true,
            fy: true
        }
    },
    jacket: { // 64x64 only
        west: {
            x: 16,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 28,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 20,
            y: 36,
            w: 8,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 32,
            y: 36,
            w: 8,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 20,
            y: 32,
            w: 8,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 28,
            y: 32,
            w: 8,
            h: 4,
            fx: true,
            fy: true
        }
    },
    rightSleeve: { // 64x64 only
        west: {
            x: 48,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 56,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 52,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 60,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 52,
            y: 48,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 56,
            y: 48,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    leftSleeve: { // 64x64 only
        west: {
            x: 40,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 48,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 44,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 52,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 44,
            y: 32,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 48,
            y: 32,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    rightTrousers: { // 64x64 only
        west: {
            x: 0,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 8,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 4,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 12,
            y: 52,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 4,
            y: 48,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 8,
            y: 48,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    },
    leftTrousers: { // 64x64 only
        west: {
            x: 0,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        east: {
            x: 8,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        south: {
            x: 4,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        north: {
            x: 12,
            y: 36,
            w: 4,
            h: 12,
            fx: false,
            fy: false
        },
        up: {
            x: 4,
            y: 32,
            w: 4,
            h: 4,
            fx: false,
            fy: false
        },
        down: {
            x: 8,
            y: 32,
            w: 4,
            h: 4,
            fx: true,
            fy: true
        }
    }
}


export const classicSkinTextureCoordinates: SkinTextureCoordinates = {
    ...baseSkinCoordinates
};

export const slimSkinTextureCoordinates: SkinTextureCoordinates = merge(baseSkinCoordinates, <SkinTextureCoordinates>{
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
