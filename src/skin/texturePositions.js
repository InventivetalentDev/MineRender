/**
 * Texture positions for Minecraft's player model
 */
const texturePositions =  {
    head: [
        {// 64x32
            right: {
                x: 0,
                y: 16,
                w: 8,
                h: 8,
                flipX: true
            },
            front: {
                x: 8,
                y: 16,
                w: 8,
                h: 8
            },
            left: {
                x: 16,
                y: 16,
                w: 8,
                h: 8,
                flipX: true
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
            right: {
                x: 0,
                y: 48,
                w: 8,
                h: 8,
                flipX: true
            },
            front: {
                x: 8,
                y: 48,
                w: 8,
                h: 8
            },
            left: {
                x: 16,
                y: 48,
                w: 8,
                h: 8,
                flipX: true
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
            right: {
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
            left: {
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
                flipY: true
            }
        },
        {// 64x64
            right: {
                x: 16,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 20,
                y: 32,
                w: 8,
                h: 12
            },
            left: {
                x: 28,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
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
                flipY: true
            }
        }
    ],
    leftArm: [
        {// 64x32 - same as rightArm
            right: {
                x: 40,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 44,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            left: {
                x: 48,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            back: {
                x: 52,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            top: {
                x: 44,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            },
            bottom: {
                x: 48,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            }
        },
        {// 64x64
            right: {
                x: 32,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 36,
                y: 0,
                w: 4,
                h: 12,
                sw: 3,
                flipX: true
            },
            left: {
                x: 40,
                y: 0,
                w: 4,
                h: 12,
                sx: 39,
                flipX: true
            },
            back: {
                x: 44,
                y: 0,
                w: 4,
                h: 12,
                sx: 43,
                sw: 3,
                flipX: true
            },
            top: {
                x: 36,
                y: 12,
                w: 4,
                h: 4,
                sw: 3,
                flipX: true
            },
            bottom: {
                x: 40,
                y: 12,
                w: 4,
                h: 4,
                sx: 39,
                sw: 3,
                flipX: true
            }
        }
    ],
    rightArm: [
        {// 64x32 - same as leftArm
            right: {
                x: 40,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 44,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            left: {
                x: 48,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            back: {
                x: 52,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            top: {
                x: 44,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            },
            bottom: {
                x: 48,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            }
        },
        {// 64x64
            right: {
                x: 40,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 44,
                y: 32,
                w: 4,
                h: 12,
                sw: 3,
                flipX: true
            },
            left: {
                x: 48,
                y: 32,
                w: 4,
                h: 12,
                sx: 47,
                flipX: true
            },
            back: {
                x: 52,
                y: 32,
                w: 4,
                h: 12,
                sx: 51,
                sw: 3,
                flipX: true
            },
            top: {
                x: 44,
                y: 44,
                w: 4,
                h: 4,
                sw: 3,
                flipX: true
            },
            bottom: {
                x: 48,
                y: 44,
                w: 4,
                h: 4,
                sx: 47,
                sw: 3,
                flipX: true
            }
        }
    ],
    leftLeg: [
        {// 64x32 - same as rightLeg
            right: {
                x: 0,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 4,
                y: 0,
                w: 4,
                h: 12,
                flipX: false
            },
            left: {
                x: 8,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
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
                flipX: true
            },
            bottom: {
                x: 8,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            }
        },
        {// 64x64
            right: {
                x: 16,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 20,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            left: {
                x: 24,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            back: {
                x: 28,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            top: {
                x: 20,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            },
            bottom: {
                x: 24,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            }
        }
    ],
    rightLeg: [
        {// 64x32 - same as leftLeg
            right: {
                x: 0,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 4,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
            },
            left: {
                x: 8,
                y: 0,
                w: 4,
                h: 12,
                flipX: true
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
                flipX: true
            },
            bottom: {
                x: 8,
                y: 12,
                w: 4,
                h: 4,
                flipX: true
            }
        },
        {// 64x64
            right: {
                x: 0,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
            },
            front: {
                x: 4,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
            },
            left: {
                x: 8,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
            },
            back: {
                x: 12,
                y: 32,
                w: 4,
                h: 12,
                flipX: true
            },
            top: {
                x: 4,
                y: 44,
                w: 4,
                h: 4,
                flipX: true
            },
            bottom: {
                x: 8,
                y: 44,
                w: 4,
                h: 4,
                flipX: true
            }
        }
    ],

    hat: {
        right: {
            x: 32,
            y: 48,
            w: 8,
            h: 8,
            flipX: true
        },
        front: {
            x: 40,
            y: 48,
            w: 8,
            h: 8
        },
        left: {
            x: 48,
            y: 48,
            w: 8,
            h: 8,
            flipX: true
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
            h: 8
        },
        bottom: {
            x: 48,
            y: 56,
            w: 8,
            h: 8,
            flipY: true
        }
    },
    jacket: {
        right: {
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
        left: {
            x: 26,
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
            h: 4
        }
    },
    leftSleeve: {
        right: {
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
        left: {
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
            sw: 3
        }
    },
    rightSleeve: {
        right: {
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
        left: {
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
            sw: 3
        }
    },
    leftTrousers: {
        right: {
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
        left: {
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
            h: 4
        }
    },
    rightTrousers: {
        right: {
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
        left: {
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
            h: 4
        }
    },

    cape: {
        right: {
            x: 0,
            y: 15,
            w: 1,
            h: 16
        },
        front: {
            x: 1,
            y: 15,
            w: 10,
            h: 16
        },
        left: {
            x: 11,
            y: 15,
            w: 1,
            h: 16
        },
        back: {
            x: 12,
            y: 15,
            w: 10,
            h: 16
        },
        top: {
            x: 1,
            y: 31,
            w: 10,
            h: 1
        },
        bottom: {
            x: 11,
            y: 31,
            w: 10,
            h: 1
        }
    },
    capeOptifine: {
        right: {
            x: 22,
            y: 0,
            w: 2,
            h: 16
        },
        front: {
            x: 2,
            y: 0,
            w: 20,
            h: 32
        },
        left: {
            x: 0,
            y: 0,
            w:2,
            h: 16
        },
        back: {
            x: 24,
            y: 0,
            w: 10,
            h: 16
        },
        top: {
            x: 2,
            y: 33,
            w: 20,
            h: 2
        },
        bottom: {
            x: 22,
            y: 32,
            w: 20,
            h: 2
        }
    }
};

export default texturePositions;