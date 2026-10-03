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

