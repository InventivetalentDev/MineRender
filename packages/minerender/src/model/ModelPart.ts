export interface ModelPart {
    textureWidth: number;
    textureHeight: number;
    textureOffsetU: number;
    textureOffsetV: number;
    pivotX: number;
    pivotY: number;
    pivotZ: number;
    pitch: number;
    yaw: number;
    roll: number;
    mirror: boolean;
    cubes: Cube[];
    children: ModelPart[];
}

export interface Cube {
    minX: number;
    minY: number;
    minZ: number;
    maxX: number;
    maxY: number;
    maxZ: number;
}

