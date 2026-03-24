import * as THREE from 'three';

export const SIMPLE_RACING_ORIENT_DEG: Record<number, number> = {
    0: 0,
    10: 180,
    16: 90,
    22: 270
};

export const SIMPLE_RACING_CELL_RAW = 9.99;
export const SIMPLE_RACING_GRID_SCALE = 0.75;
export const SIMPLE_RACING_CELL = SIMPLE_RACING_CELL_RAW * SIMPLE_RACING_GRID_SCALE;

export type TSimpleRacingTrackPiece =
    | 'track-straight'
    | 'track-corner'
    | 'track-bump'
    | 'track-finish';

export type TSimpleRacingCell = [number, number, TSimpleRacingTrackPiece, number];

export const SIMPLE_RACING_TRACK_CELLS: TSimpleRacingCell[] = [
    [-3, -3, 'track-corner', 16],
    [-2, -3, 'track-straight', 22],
    [-1, -3, 'track-straight', 22],
    [0, -3, 'track-corner', 0],
    [-3, -2, 'track-straight', 0],
    [0, -2, 'track-straight', 0],
    [-3, -1, 'track-corner', 10],
    [-2, -1, 'track-corner', 0],
    [0, -1, 'track-straight', 0],
    [-2, 0, 'track-straight', 10],
    [0, 0, 'track-finish', 0],
    [-2, 1, 'track-straight', 10],
    [0, 1, 'track-straight', 0],
    [-2, 2, 'track-corner', 10],
    [-1, 2, 'track-straight', 16],
    [0, 2, 'track-corner', 22]
];

export interface ISimpleRacingTrackBounds {
    centerX: number;
    centerZ: number;
    halfWidth: number;
    halfDepth: number;
}

export function computeSimpleRacingSpawn(cells: TSimpleRacingCell[] = SIMPLE_RACING_TRACK_CELLS): {
    position: { x: number; y: number; z: number };
    yaw: number;
} {
    const finishCell = cells.find((cell) => cell[2] === 'track-finish') ?? cells[0];
    const x = (finishCell[0] + 0.5) * SIMPLE_RACING_CELL;
    const z = (finishCell[1] + 0.5) * SIMPLE_RACING_CELL;
    const yaw = THREE.MathUtils.degToRad(SIMPLE_RACING_ORIENT_DEG[finishCell[3]] ?? 0);
    return {
        position: { x, y: 0.7, z },
        yaw
    };
}

export function computeSimpleRacingTrackBounds(cells: TSimpleRacingCell[] = SIMPLE_RACING_TRACK_CELLS): ISimpleRacingTrackBounds {
    if (cells.length === 0) {
        return { centerX: 0, centerZ: 0, halfWidth: 30, halfDepth: 30 };
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    for (const [gx, gz] of cells) {
        minX = Math.min(minX, gx);
        maxX = Math.max(maxX, gx);
        minZ = Math.min(minZ, gz);
        maxZ = Math.max(maxZ, gz);
    }

    return {
        centerX: ((minX + maxX + 1) / 2) * SIMPLE_RACING_CELL,
        centerZ: ((minZ + maxZ + 1) / 2) * SIMPLE_RACING_CELL,
        halfWidth: (((maxX - minX + 1) / 2) * SIMPLE_RACING_CELL) + SIMPLE_RACING_CELL,
        halfDepth: (((maxZ - minZ + 1) / 2) * SIMPLE_RACING_CELL) + SIMPLE_RACING_CELL
    };
}
