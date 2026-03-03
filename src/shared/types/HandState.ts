import { IHandState, IHandJointState, INetworkHandState } from '../contracts/ITrackingProvider';
import { IPose } from '../contracts/IMath';

export class HandState implements IHandState {
    public active: boolean;
    public hasJoints: boolean;
    public pose: IPose;
    public pointerPose: IPose;
    public joints: IHandJointState[];

    constructor(offsetX: number = 0, defaultActive: boolean = false) {
        this.active = defaultActive;
        this.hasJoints = false;
        this.pose = {
            position: { x: offsetX, y: 0.8, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
        this.pointerPose = {
            position: { x: offsetX, y: 0.8, z: 0 },
            quaternion: { x: 0, y: 0, z: 0, w: 1 }
        };
        this.joints = [];
        for (let i = 0; i < 25; i++) {
            this.joints.push({
                pose: {
                    position: { x: 0, y: 0, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                }
            });
        }
    }

    public copyFrom(source: IHandState): void {
        this.active = source.active;
        this.hasJoints = source.hasJoints;

        this.pose.position.x = source.pose.position.x;
        this.pose.position.y = source.pose.position.y;
        this.pose.position.z = source.pose.position.z;
        this.pose.quaternion.x = source.pose.quaternion.x;
        this.pose.quaternion.y = source.pose.quaternion.y;
        this.pose.quaternion.z = source.pose.quaternion.z;
        this.pose.quaternion.w = source.pose.quaternion.w;

        this.pointerPose.position.x = source.pointerPose.position.x;
        this.pointerPose.position.y = source.pointerPose.position.y;
        this.pointerPose.position.z = source.pointerPose.position.z;
        this.pointerPose.quaternion.x = source.pointerPose.quaternion.x;
        this.pointerPose.quaternion.y = source.pointerPose.quaternion.y;
        this.pointerPose.quaternion.z = source.pointerPose.quaternion.z;
        this.pointerPose.quaternion.w = source.pointerPose.quaternion.w;

        for (let i = 0; i < 25; i++) {
            const sJ = source.joints[i];
            const dJ = this.joints[i];
            if (!sJ || !dJ) continue;
            dJ.pose.position.x = sJ.pose.position.x;
            dJ.pose.position.y = sJ.pose.position.y;
            dJ.pose.position.z = sJ.pose.position.z;
            dJ.pose.quaternion.x = sJ.pose.quaternion.x;
            dJ.pose.quaternion.y = sJ.pose.quaternion.y;
            dJ.pose.quaternion.z = sJ.pose.quaternion.z;
            dJ.pose.quaternion.w = sJ.pose.quaternion.w;
        }
    }

    /**
     * Safely merges a partial network payload into this strict local state.
     * IF statements are required here because `INetworkHandState` properties are optional 
     * in order to save bandwidth. We only update properties that actually arrived in the packet.
     */
    public applyData(data: INetworkHandState): void {
        if (!data) return;
        if (data.active !== undefined) this.active = !!data.active;
        if (data.hasJoints !== undefined) this.hasJoints = !!data.hasJoints;

        if (data.pose) {
            if (data.pose.position) {
                this.pose.position.x = data.pose.position.x;
                this.pose.position.y = data.pose.position.y;
                this.pose.position.z = data.pose.position.z;
            }
            if (data.pose.quaternion) {
                this.pose.quaternion.x = data.pose.quaternion.x;
                this.pose.quaternion.y = data.pose.quaternion.y;
                this.pose.quaternion.z = data.pose.quaternion.z;
                this.pose.quaternion.w = data.pose.quaternion.w;
            }
        }

        if (data.pointerPose) {
            if (data.pointerPose.position) {
                this.pointerPose.position.x = data.pointerPose.position.x;
                this.pointerPose.position.y = data.pointerPose.position.y;
                this.pointerPose.position.z = data.pointerPose.position.z;
            }
            if (data.pointerPose.quaternion) {
                this.pointerPose.quaternion.x = data.pointerPose.quaternion.x;
                this.pointerPose.quaternion.y = data.pointerPose.quaternion.y;
                this.pointerPose.quaternion.z = data.pointerPose.quaternion.z;
                this.pointerPose.quaternion.w = data.pointerPose.quaternion.w;
            }
        }

        if (data.joints && Array.isArray(data.joints)) {
            for (let i = 0; i < 25; i++) {
                const jData = data.joints[i];
                if (!jData || !this.joints[i]) continue;

                if (jData.pose?.position) {
                    this.joints[i].pose.position.x = jData.pose.position.x;
                    this.joints[i].pose.position.y = jData.pose.position.y;
                    this.joints[i].pose.position.z = jData.pose.position.z;
                } else if (jData.p) {
                    this.joints[i].pose.position.x = jData.p.x;
                    this.joints[i].pose.position.y = jData.p.y;
                    this.joints[i].pose.position.z = jData.p.z;
                }

                if (jData.pose?.quaternion) {
                    this.joints[i].pose.quaternion.x = jData.pose.quaternion.x;
                    this.joints[i].pose.quaternion.y = jData.pose.quaternion.y;
                    this.joints[i].pose.quaternion.z = jData.pose.quaternion.z;
                    this.joints[i].pose.quaternion.w = jData.pose.quaternion.w;
                } else if (jData.q) {
                    this.joints[i].pose.quaternion.x = jData.q.x;
                    this.joints[i].pose.quaternion.y = jData.q.y;
                    this.joints[i].pose.quaternion.z = jData.q.z;
                    this.joints[i].pose.quaternion.w = jData.q.w;
                }
            }
        }
    }
}
