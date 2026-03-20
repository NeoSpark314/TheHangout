import type { ITargetDefinition } from './TargetTossTypes';

export const BALL_DEFINITIONS = [
    { id: 'target-toss-ball-a', position: { x: -0.45, y: 1.05, z: 2.6 }, color: 0xff8b3d },
    { id: 'target-toss-ball-b', position: { x: 0.0, y: 1.05, z: 2.6 }, color: 0xffc145 },
    { id: 'target-toss-ball-c', position: { x: 0.45, y: 1.05, z: 2.6 }, color: 0xff5f6d }
] as const;

export const TARGET_DEFINITIONS: ITargetDefinition[] = [
    {
        id: 'main-target-zone',
        position: { x: 0.0, y: 0.04, z: -5.9 },
        size: { x: 2.95, y: 0.05, z: 2.95 },
        rings: [
            { radius: 0.42, points: 30, color: 0xffcf57 },
            { radius: 0.86, points: 20, color: 0x7cf2a1 },
            { radius: 1.35, points: 10, color: 0x59d7ff }
        ]
    }
];

export const TARGET_TOSS_RESET_DELAY_MS = 3600;
