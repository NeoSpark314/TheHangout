import { NetworkEntity } from './NetworkEntity';
import { Vector3, Quaternion } from '../interfaces/IMath';

export interface HandJointState {
    position: Vector3;
    quaternion: Quaternion;
}

export interface HandState {
    active: boolean;
    position: Vector3;
    quaternion: Quaternion;
    joints: HandJointState[];
}

export abstract class PlayerEntity extends NetworkEntity {
    public name: string = '';
    public headHeight: number = 1.7;
    public headState: { position: Vector3, quaternion: Quaternion };
    public handStates: { left: HandState, right: HandState };

    constructor(id: string, type: string, isAuthority: boolean) {
        super(id, type, isAuthority);

        this.headState = {
            position: { x: 0, y: 0.8, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };

        const createHandState = (offsetX: number): HandState => {
            const state: HandState = {
                active: false,
                position: { x: offsetX, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                joints: []
            };
            for (let i = 0; i < 25; i++) {
                state.joints.push({
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                });
            }
            return state;
        };

        this.handStates = {
            left: createHandState(-0.4),
            right: createHandState(0.4)
        };
    }
}
