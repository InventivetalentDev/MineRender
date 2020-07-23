/**
 * Texture positions for Minecraft's player model
 */
const texturePositions =  {
    head: [
        {// 64x32
            left: {
                x: 0,
                y: 16,
                w: 8,
                h: 8,
                flipX: false
            },
            front: {
                x: 8,
                y: 16,
                w: 8,
                h: 8
            },
            right: {
                x: 16,
                y: 16,
                w: 8,
                h: 8,
                flipX: false
            },
            back: {
                x: 24,
                y: 16,
                w: 8,
                h: 8
            },
            top: {
                x: 8,
                y: 24,
                w: 8,
                h: 8
            },
            bottom: {
                x: 16,
                y: 24,
                w: 8,
                h: 8,
                flipX: true,
                flipY: true
            }
        },
        {// 64x64
            left: {
                x: 0,
                y: 48,
                w: 8,
                h: 8,
                flipX: false
            },
            front: {
                x: 8,
                y: 48,
                w: 8,
                h: 8
            },
            right: {
                x: 16,
                y: 48,
                w: 8,
                h: 8,
                flipX: false
            },
            back: {
                x: 24,
                y: 48,
                w: 8,
                h: 8
            },
            top: {
                x: 8,
                y: 56,
                w: 8,
                h: 8
            },
            bottom: {
                x: 16,
                y: 56,
                w: 8,
                h: 8,
                flipX: true,
                flipY: true
            }
        }
    ],
    body: [
        {// 64x32
            left: {
                x: 16,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 20,
                y: 0,
                w: 8,
                h: 12
            },
            right: {
                x: 28,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            back: {
                x: 32,
                y: 0,
                w: 8,
                h: 12
            },
            top: {
                x: 20,
                y: 12,
                w: 8,
                h: 4
            },
            bottom: {
                x: 28,
                y: 12,
                w: 8,
                h: 4,
                flipY: true,
                flipX: true
            }
        },
        {// 64x64
            left: {
                x: 16,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 20,
                y: 32,
                w: 8,
                h: 12
            },
            right: {
                x: 28,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 32,
                y: 32,
                w: 8,
                h: 12
            },
            top: {
                x: 20,
                y: 44,
                w: 8,
                h: 4
            },
            bottom: {
                x: 28,
                y: 44,
                w: 8,
                h: 4,
                flipY: true,
                flipX: true
            }
        }
    ],
    rightArm: [
        {// 64x32 - same as rightArm
            left: {
                x: 40,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 44,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            right: {
                x: 48,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 52,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            top: {
                x: 44,
                y: 12,
                w: 4,
                h: 4,
                flipX: false
            },
            bottom: {
                x: 48,
                y: 12,
                w: 4,
                h: 4,
                flipX: true,
                flipY: true
            }
        },
        {// 64x64
            left: {
                x: 32,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 36,
                y: 0,
                w: 4,
                h: 12,
                sw: 3,
                flipX: false
            },
            right: {
                x: 40,
                y: 0,
                w: 4,
                h: 12,
                sx: 39,
                flipX: false
            },
            back: {
                x: 44,
                y: 0,
                w: 4,
                h: 12,
                sx: 43,
                sw: 3,
                flipX: false
            },
            top: {
                x: 36,
                y: 12,
                w: 4,
                h: 4,
                sw: 3,
                flipX: false
            },
            bottom: {
                x: 40,
                y: 12,
                w: 4,
                h: 4,
                sx: 39,
                sw: 3,
                flipY: true,
                flipX: true
            }
        }
    ],
    leftArm: [
        {// 64x32 - same as leftArm
            left: {
                x: 40,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 44,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            right: {
                x: 48,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 52,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            top: {
                x: 44,
                y: 12,
                w: 4,
                h: 4,
                flipX: false
            },
            bottom: {
                x: 48,
                y: 12,
                w: 4,
                h: 4,
                flipX: true,
                flipY: true
            }
        },
        {// 64x64
            left: {
                x: 40,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 44,
                y: 32,
                w: 4,
                h: 12,
                sw: 3,
                flipX: false
            },
            right: {
                x: 48,
                y: 32,
                w: 4,
                h: 12,
                sx: 47,
                flipX: false
            },
            back: {
                x: 52,
                y: 32,
                w: 4,
                h: 12,
                sx: 51,
                sw: 3,
                flipX: false
            },
            top: {
                x: 44,
                y: 44,
                w: 4,
                h: 4,
                sw: 3,
                flipX: false
            },
            bottom: {
                x: 48,
                y: 44,
                w: 4,
                h: 4,
                sx: 47,
                sw: 3,
                flipY: true,
                flipX: true
            }
        }
    ],
    rightLeg: [
        {// 64x32 - same as rightLeg
            left: {
                x: 0,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 4,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            right: {
                x: 8,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 12,
                y: 0,
                w: 4,
                h: 12
            },
            top: {
                x: 4,
                y: 12,
                w: 4,
                h: 4,
                flipX: false
            },
            bottom: {
                x: 8,
                y: 12,
                w: 4,
                h: 4,
                flipX: true,
                flipY: true
            }
        },
        {// 64x64
            left: {
                x: 16,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 20,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            right: {
                x: 24,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 28,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            top: {
                x: 20,
                y: 12,
                w: 4,
                h: 4,
                flipX: false
            },
            bottom: {
                x: 24,
                y: 12,
                w: 4,
                h: 4,
                flipY: true,
                flipX: true
            }
        }
    ],
    leftLeg: [
        {// 64x32 - same as leftLeg
            left: {
                x: 0,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 4,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            right: {
                x: 8,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 12,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            top: {
                x: 4,
                y: 12,
                w: 4,
                h: 4,
                flipX: false
            },
            bottom: {
                x: 8,
                y: 12,
                w: 4,
                h: 4,
                flipX: true,
                flipY: true
            }
        },
        {// 64x64
            left: {
                x: 0,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            front: {
                x: 4,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            right: {
                x: 8,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            back: {
                x: 12,
                y: 32,
                w: 4,
                h: 12,
                flipX: false
            },
            top: {
                x: 4,
                y: 44,
                w: 4,
                h: 4,
                flipX: false
            },
            bottom: {
                x: 8,
                y: 44,
                w: 4,
                h: 4,
                flipY: true,
                flipX: true
            }
        }
    ],

    hat: {
        left: {
            x: 32,
            y: 48,
            w: 8,
            h: 8
        },
        front: {
            x: 40,
            y: 48,
            w: 8,
            h: 8
        },
        right: {
            x: 48,
            y: 48,
            w: 8,
            h: 8
        },
        back: {
            x: 56,
            y: 48,
            w: 8,
            h: 8
        },
        top: {
            x: 40,
            y: 56,
            w: 8,
            h: 8,
            flipX: false
        },
        bottom: {
            x: 48,
            y: 56,
            w: 8,
            h: 8,
            flipY: true,
            flipX: true
        }
    },
    jacket: {
        left: {
            x: 16,
            y: 16,
            w: 4,
            h: 12
        },
        front: {
            x: 20,
            y: 16,
            w: 8,
            h: 12
        },
        right: {
            x: 28,
            y: 16,
            w: 4,
            h: 12
        },
        back: {
            x: 32,
            y: 16,
            w: 8,
            h: 12
        },
        top: {
            x: 20,
            y: 28,
            w: 8,
            h: 4
        },
        bottom: {
            x: 28,
            y: 28,
            w: 8,
            h: 4,
            flipY: true,
            flipX: true
        }
    },
    rightSleeve: {
        left: {
            x: 48,
            y: 0,
            w: 4,
            h: 12
        },
        front: {
            x: 52,
            y: 0,
            w: 4,
            h: 12,
            sw: 3
        },
        right: {
            x: 56,
            y: 0,
            w: 4,
            h: 12,
            sx: 55
        },
        back: {
            x: 60,
            y: 0,
            w: 4,
            h: 12,
            sx: 59,
            sw: 3
        },
        top: {
            x: 52,
            y: 12,
            w: 4,
            h: 4,
            sw: 3
        },
        bottom: {
            x: 56,
            y: 12,
            w: 4,
            h: 4,
            sx: 55,
            sw: 3,
            flipY: true,
            flipX: true
        }
    },
    leftSleeve: {
        left: {
            x: 40,
            y: 16,
            w: 4,
            h: 12
        },
        front: {
            x: 44,
            y: 16,
            w: 4,
            h: 12,
            sw: 3
        },
        right: {
            x: 48,
            y: 16,
            w: 4,
            h: 12,
            sx: 47
        },
        back: {
            x: 52,
            y: 16,
            w: 4,
            h: 12,
            sx: 51,
            sw: 3
        },
        top: {
            x: 44,
            y: 28,
            w: 4,
            h: 4,
            sw: 3
        },
        bottom: {
            x: 48,
            y: 28,
            w: 4,
            h: 4,
            sx: 47,
            sw: 3,
            flipY: true,
            flipX: true
        }
    },
    rightTrousers: {
        left: {
            x: 0,
            y: 0,
            w: 4,
            h: 12
        },
        front: {
            x: 4,
            y: 0,
            w: 4,
            h: 12
        },
        right: {
            x: 8,
            y: 0,
            w: 4,
            h: 12
        },
        back: {
            x: 12,
            y: 0,
            w: 4,
            h: 12
        },
        top: {
            x: 4,
            y: 12,
            w: 4,
            h: 4
        },
        bottom: {
            x: 8,
            y: 12,
            w: 4,
            h: 4,
            flipY: true,
            flipX: true
        }
    },
    leftTrousers: {
        left: {
            x: 0,
            y: 16,
            w: 4,
            h: 12
        },
        front: {
            x: 4,
            y: 16,
            w: 4,
            h: 12
        },
        right: {
            x: 8,
            y: 16,
            w: 4,
            h: 12
        },
        back: {
            x: 12,
            y: 16,
            w: 4,
            h: 12
        },
        top: {
            x: 4,
            y: 28,
            w: 4,
            h: 4
        },
        bottom: {
            x: 8,
            y: 28,
            w: 4,
            h: 4,
            flipY: true,
            flipX: true
        }
    },

    cape: {
        right: {
            x: 0,
            y: 5,
            w: 1,
            h: 16
        },
        front: {
            x: 1,
            y: 5,
            w: 10,
            h: 16
        },
        left: {
            x: 11,
            y: 5,
            w: 1,
            h: 16
        },
        back: {
            x: 12,
            y: 5,
            w: 10,
            h: 16
        },
        top: {
            x: 1,
            y: 21,
            w: 10,
            h: 1
        },
        bottom: {
            x: 11,
            y: 21,
            w: 10,
            h: 1
        }
    },
    capeRelative: { // Cape coordinates relative to image dimensions, starting bottom-left
        right: {
            x: 0,
            y: 15/32,
            w: 1/64,
            h: 16/32
        },
        front: {
            x: 1/64,
            y: 15/32,
            w: 10/64,
            h: 16/32
        },
        left: {
            x: 11/64,
            y: 15/32,
            w: 1/64,
            h: 16/32
        },
        back: {
            x: 12/64,
            y: 15/32,
            w: 10/64,
            h: 16/32
        },
        top: {
            x: 1/64,
            y: 31/32,
            w: 10/64,
            h: 1/32
        },
        bottom: {
            x: 11/64,
            y: 31/32,
            w: 10/64,
            h: 1/32
        }
    },
    capeOptifineRelative: {
        right: {
            x: 0,
            y: 10/44,
            w: 2/92,
            h: 32/44
        },
        front: {
            x: 2/92,
            y: 10/44,
            w: 20/92,
            h: 32/44
        },
        left: {
            x: 22/92,
            y: 10/44,
            w: 2/92,
            h: 32/44
        },
        back: {
            x: 24/92,
            y: 10/44,
            w: 20/92,
            h: 32/44
        },
        top: {
            x: 2/92,
            y: 42/44,
            w: 20/92,
            h: 2/44
        },
        bottom: {
            x: 22/92,
            y: 42/44,
            w: 20/92,
            h: 2/44
        }
    },
    capeOptifine: {
        right: {
            x: 0,
            y: 10,
            w: 2,
            h: 32
        },
        front: {
            x: 2,
            y: 10,
            w: 20,
            h: 32
        },
        left: {
            x: 22,
            y: 10,
            w: 2,
            h: 32
        },
        back: {
            x: 24,
            y: 10,
            w: 20,
            h: 32
        },
        top: {
            x: 2,
            y: 42,
            w: 20,
            h: 2
        },
        bottom: {
            x: 22,
            y: 42,
            w: 20,
            h: 2
        }
    },
    capeLabymodRelative: {
        right: {
            x: 0,
            y: 0,
            w: 1/22,
            h: 16/17
        },
        front: {
            x: 1/22,
            y: 0,
            w: 10/22,
            h: 16/17
        },
        left: {
            x: 11/22,
            y: 0,
            w: 1/22,
            h: 16/17
        },
        back: {
            x: 12/22,
            y: 0,
            w: 10/22,
            h: 16/17
        },
        top: {
            x: 1/22,
            y: 16/17,
            w: 10/22,
            h: 1/17
        },
        bottom: {
            x: 11/22,
            y: 16/17,
            w: 10/22,
            h: 1/17
        }
    },
};

export default texturePositions;
