import { IHandState, IHandJointState, INetworkHandState } from '../interfaces/ITrackingProvider';
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

    /**
     * Safely merges a partial network payload into this strict local state.
     * IF statements are required here because `INetworkHandState` properties are optional 
     * in order to save bandwidth. We only update properties that actually arrived in the packet.
     */
    public applyData(data: INetworkHandState): void {
        if (!data) return;
        this.active = !!data.active;
        this.hasJoints = !!data.hasJoints;

        if (data.position) {
            this.position.x = data.position.x;
            this.position.y = data.position.y;
            this.position.z = data.position.z;
        }
        if (data.quaternion) {
            this.quaternion.x = data.quaternion.x;
            this.quaternion.y = data.quaternion.y;
            this.quaternion.z = data.quaternion.z;
            this.quaternion.w = data.quaternion.w;
        }
        if (data.pointerPosition) {
            this.pointerPosition.x = data.pointerPosition.x;
            this.pointerPosition.y = data.pointerPosition.y;
            this.pointerPosition.z = data.pointerPosition.z;
        }
        if (data.pointerQuaternion) {
            this.pointerQuaternion.x = data.pointerQuaternion.x;
            this.pointerQuaternion.y = data.pointerQuaternion.y;
            this.pointerQuaternion.z = data.pointerQuaternion.z;
            this.pointerQuaternion.w = data.pointerQuaternion.w;
        }

        if (data.joints && Array.isArray(data.joints)) {
            for (let i = 0; i < 25; i++) {
                const jData = data.joints[i];
                if (!jData || !this.joints[i]) continue;

                if (jData.position) {
                    this.joints[i].position.x = jData.position.x;
                    this.joints[i].position.y = jData.position.y;
                    this.joints[i].position.z = jData.position.z;
                } else if (jData.p) {
                    this.joints[i].position.x = jData.p.x;
                    this.joints[i].position.y = jData.p.y;
                    this.joints[i].position.z = jData.p.z;
                }

                if (jData.quaternion) {
                    this.joints[i].quaternion.x = jData.quaternion.x;
                    this.joints[i].quaternion.y = jData.quaternion.y;
                    this.joints[i].quaternion.z = jData.quaternion.z;
                    this.joints[i].quaternion.w = jData.quaternion.w;
                } else if (jData.q) {
                    this.joints[i].quaternion.x = jData.q.x;
                    this.joints[i].quaternion.y = jData.q.y;
                    this.joints[i].quaternion.z = jData.q.z;
                    this.joints[i].quaternion.w = jData.q.w;
                }
            }
        }
    }
}
