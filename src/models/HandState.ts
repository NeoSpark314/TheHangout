import { IHandState, IHandJointState } from '../interfaces/ITrackingProvider';
import { IVector3, IQuaternion } from '../interfaces/IMath';

export class HandState implements IHandState {
    public active: boolean;
    public hasJoints: boolean;
    public position: IVector3;
    public quaternion: IQuaternion;
    public joints: IHandJointState[];
    public pointerPosition: IVector3;
    public pointerQuaternion: IQuaternion;

    constructor(offsetX: number = 0, defaultActive: boolean = false) {
        this.active = defaultActive;
        this.hasJoints = false;
        this.position = { x: offsetX, y: 0.8, z: 0 };
        this.quaternion = { x: 0, y: 0, z: 0, w: 1 };
        this.pointerPosition = { x: offsetX, y: 0.8, z: 0 };
        this.pointerQuaternion = { x: 0, y: 0, z: 0, w: 1 };
        this.joints = [];
        for (let i = 0; i < 25; i++) {
            this.joints.push({
                position: { x: 0, y: 0, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 }
            });
        }
    }

    public copyFrom(source: IHandState): void {
        this.active = source.active;
        this.hasJoints = source.hasJoints;

        this.position.x = source.position.x;
        this.position.y = source.position.y;
        this.position.z = source.position.z;
        this.quaternion.x = source.quaternion.x;
        this.quaternion.y = source.quaternion.y;
        this.quaternion.z = source.quaternion.z;
        this.quaternion.w = source.quaternion.w;

        this.pointerPosition.x = source.pointerPosition.x;
        this.pointerPosition.y = source.pointerPosition.y;
        this.pointerPosition.z = source.pointerPosition.z;
        this.pointerQuaternion.x = source.pointerQuaternion.x;
        this.pointerQuaternion.y = source.pointerQuaternion.y;
        this.pointerQuaternion.z = source.pointerQuaternion.z;
        this.pointerQuaternion.w = source.pointerQuaternion.w;

        for (let i = 0; i < 25; i++) {
            const sJ = source.joints[i];
            const dJ = this.joints[i];
            if (!sJ || !dJ) continue;
            dJ.position.x = sJ.position.x;
            dJ.position.y = sJ.position.y;
            dJ.position.z = sJ.position.z;
            dJ.quaternion.x = sJ.quaternion.x;
            dJ.quaternion.y = sJ.quaternion.y;
            dJ.quaternion.z = sJ.quaternion.z;
            dJ.quaternion.w = sJ.quaternion.w;
        }
    }
}
