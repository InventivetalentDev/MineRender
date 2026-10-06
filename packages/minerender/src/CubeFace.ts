export enum CubeFace {
    EAST = "east", // px
    WEST = "west", // nx
    UP = "up", // py
    DOWN = "down", // ny
    SOUTH = "south", // pz
    NORTH = "north", // nz
}

export enum CubeFaceIndex {
    EAST,
    WEST,
    UP,
    DOWN,
    SOUTH,
    NORTH
}

export const CUBE_FACES = Object.values(CubeFace);

export const CUBE_FACE_OFFSETS = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]
] as const;
