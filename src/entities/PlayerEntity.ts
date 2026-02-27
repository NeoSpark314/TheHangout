import { NetworkEntity } from './NetworkEntity';
import { GameContext } from '../core/GameState';
import { IVector3, IQuaternion } from '../interfaces/IMath';

export interface IHandJointState {
    position: IVector3;
    quaternion: IQuaternion;
}

export interface IHandState {
    active: boolean;
    hasJoints: boolean;
    position: IVector3;
    quaternion: IQuaternion;
    joints: IHandJointState[];
}

export abstract class PlayerEntity extends NetworkEntity {
    public name: string = '';
    public headHeight: number = 1.7;
    public headState: { position: IVector3, quaternion: IQuaternion };
    public handStates: { left: IHandState, right: IHandState };

    constructor(protected context: GameContext, id: string, type: string, isAuthority: boolean) {
        super(context, id, type, isAuthority);

        this.headState = {
            position: { x: 0, y: this.headHeight, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
        const createHandState = (offsetX: number): IHandState => {
            const state: IHandState = {
                active: false,
                hasJoints: false,
                position: { x: offsetX, y: 0.8, z: 0 },
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
