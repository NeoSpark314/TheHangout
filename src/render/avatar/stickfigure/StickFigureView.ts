import * as THREE from 'three';
import { EntityView } from '../../views/EntityView';
import { AppContext } from '../../../app/AppContext';
import { NameTagComponent } from '../components/NameTagComponent';
import { VoiceAudioComponent } from '../components/VoiceAudioComponent';
import { StickFigureRig, StickFigureBones, StickFigureRigVisuals } from './StickFigureRig';
import { StickFigureHands } from './StickFigureHands';
import { IPlayerAvatarRenderState } from '../IPlayerAvatarRenderState';
import { composeAvatarWorldPoses, LEFT_HAND_FINGER_JOINTS, RIGHT_HAND_FINGER_JOINTS } from '../../../shared/avatar/AvatarSkeletonUtils';

export type IPlayerViewState = IPlayerAvatarRenderState;

export class StickFigureView extends EntityView<IPlayerAvatarRenderState> {
    public color: string | number;
    public isLocal: boolean;
    public headMesh!: THREE.Mesh;
    private currentHeadHeight: number = 1.7;

    private accentMaterial!: THREE.MeshBasicMaterial;
    private cyberMaterial!: THREE.MeshBasicMaterial;
    private darkMaterial!: THREE.MeshBasicMaterial;
    private featureMaterial!: THREE.MeshBasicMaterial;
    private headOutline!: THREE.LineSegments;
    private leftEye!: THREE.Mesh;
    private rightEye!: THREE.Mesh;
    private mouth!: THREE.Mesh;
    private torso!: THREE.Mesh;
    private neckJoint!: THREE.Mesh;
    private waistJoint!: THREE.Mesh;
    private leftKnee!: THREE.Mesh;
    private rightKnee!: THREE.Mesh;
    private leftShoulderJoint!: THREE.Mesh;
    private rightShoulderJoint!: THREE.Mesh;
    private leftElbowJoint!: THREE.Mesh;
    private rightElbowJoint!: THREE.Mesh;
    private leftLeg!: THREE.Mesh;
    private rightLeg!: THREE.Mesh;
    private leftLowerLegMesh!: THREE.Mesh;
    private rightLowerLegMesh!: THREE.Mesh;
    private shoulders!: THREE.Mesh;
    private pelvis!: THREE.Mesh;
    private leftUpperArm!: THREE.Mesh;
    private leftForearm!: THREE.Mesh;
    private rightUpperArm!: THREE.Mesh;
    private rightForearm!: THREE.Mesh;

    // Bone Hierarchy
    private skeleton!: THREE.Skeleton;
    private bones: Record<string, THREE.Bone> = {};

    private handMeshes: { left: THREE.Mesh[], right: THREE.Mesh[] } = { left: [], right: [] };
    private handCylinders: { left: THREE.Mesh[], right: THREE.Mesh[] } = { left: [], right: [] };
    private wristMeshes: { left: THREE.Mesh, right: THREE.Mesh };
    private nameTagComponent!: NameTagComponent;

    private voiceAudio!: VoiceAudioComponent;
    private rig!: StickFigureRig;
    private hands!: StickFigureHands;
    private readonly tmpTargetPos = new THREE.Vector3();
    private readonly tmpTargetQuat = new THREE.Quaternion();

    constructor(private context: AppContext, { color = 0x00ffff, isLocal = false }: { color?: string | number, isLocal?: boolean } = {}) {
        super(new THREE.Group());
        this.color = color;
        this.isLocal = isLocal;

        // Initializing wrist meshes to avoid 'used before assigned' error, 
        // though _buildGeometry will re-assign them properly.
        const dummyGeom = new THREE.BoxGeometry(0.01, 0.01, 0.01);
        const dummyMat = new THREE.MeshBasicMaterial();
        this.wristMeshes = {
            left: new THREE.Mesh(dummyGeom, dummyMat),
            right: new THREE.Mesh(dummyGeom, dummyMat)
        };

        this._buildGeometry();
        this.nameTagComponent = new NameTagComponent(this.mesh, () => this.headMesh.position.y, this.color);
        this.voiceAudio = new VoiceAudioComponent(this.headMesh, this.context.runtime.render?.audioListener, this.isLocal);
        this.rig = new StickFigureRig(
            this.mesh,
            this.bones as unknown as StickFigureBones,
            {
                headMesh: this.headMesh,
                torso: this.torso,
                shoulders: this.shoulders,
                pelvis: this.pelvis,
                leftLeg: this.leftLeg,
                leftLowerLegMesh: this.leftLowerLegMesh,
                rightLeg: this.rightLeg,
                rightLowerLegMesh: this.rightLowerLegMesh,
                leftUpperArm: this.leftUpperArm,
                leftForearm: this.leftForearm,
                rightUpperArm: this.rightUpperArm,
                rightForearm: this.rightForearm
            } as StickFigureRigVisuals,
            () => this._updateNameTagPosition()
        );
        this.hands = new StickFigureHands(this.wristMeshes, this.handMeshes, this.handCylinders);
    }

    public attachVoiceStream(stream: MediaStream): void {
        this.voiceAudio.attachVoiceStream(stream);
    }

    public attachAudioChunk(data: { chunk: string, isHeader: boolean } | string): void {
        this.voiceAudio.attachAudioChunk(data);
    }

    public setMuted(muted: boolean): void {
        this.voiceAudio.setMuted(muted);
    }

    public getAudioLevel(): number {
        return this.voiceAudio.getAudioLevel();
    }

    private _buildGeometry(): void {
        this.accentMaterial = new THREE.MeshBasicMaterial({ color: this.color });
        this.cyberMaterial = new THREE.MeshBasicMaterial({ color: 0x1a1a1a });
        this.darkMaterial = new THREE.MeshBasicMaterial({ color: 0x050510 });
        this.featureMaterial = new THREE.MeshBasicMaterial({ color: 0x000000 });

        const headSize = 0.3;
        const headDepth = 0.12;
        const headGeometry = new THREE.BoxGeometry(headSize, headSize, headDepth);
        headGeometry.translate(0, headSize / 2, 0);

        const faceMaterial = this.accentMaterial;
        const materials = [this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, faceMaterial, this.darkMaterial];

        this.headMesh = new THREE.Mesh(headGeometry, materials);
        const headEdges = new THREE.EdgesGeometry(headGeometry);
        this.headOutline = new THREE.LineSegments(headEdges, new THREE.LineBasicMaterial({ color: this.color }));
        this.headMesh.add(this.headOutline);
        this.headMesh.position.y = 1.5;
        if (this.isLocal) this.headMesh.visible = false;
        this.mesh.add(this.headMesh);

        const eyeGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8);
        eyeGeom.rotateX(Math.PI / 2);
        this.leftEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.leftEye.position.set(-0.07, headSize * 0.7, headDepth / 2 + 0.01);
        this.headMesh.add(this.leftEye);
        this.rightEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.rightEye.position.set(0.07, headSize * 0.7, headDepth / 2 + 0.01);
        this.headMesh.add(this.rightEye);

        const mouthGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
        mouthGeom.rotateZ(Math.PI / 2);
        mouthGeom.rotateX(Math.PI / 2);
        this.mouth = new THREE.Mesh(mouthGeom, this.featureMaterial);
        this.mouth.position.set(0, headSize * 0.3, headDepth / 2 + 0.01);
        this.headMesh.add(this.mouth);

        const limbRadius = 0.025;
        const cylinderGeom = new THREE.CylinderGeometry(limbRadius, limbRadius, 1, 6);
        const jointGeom = new THREE.SphereGeometry(0.04, 8, 4);

        // --- BONE HIERARCHY ---
        const hips = new THREE.Bone();
        hips.name = 'hips';
        const spine = new THREE.Bone();
        spine.name = 'spine';
        const chest = new THREE.Bone();
        chest.name = 'chest';
        const upperChest = new THREE.Bone();
        upperChest.name = 'upperChest';
        const neck = new THREE.Bone();
        neck.name = 'neck';
        const headBone = new THREE.Bone(); // We'll attach headMesh here
        headBone.name = 'head';

        const leftShoulder = new THREE.Bone();
        leftShoulder.name = 'leftShoulder';
        const leftUpperArm = new THREE.Bone();
        leftUpperArm.name = 'leftUpperArm';
        const leftLowerArm = new THREE.Bone();
        leftLowerArm.name = 'leftLowerArm';
        const leftHand = new THREE.Bone();
        leftHand.name = 'leftHand';

        const rightShoulder = new THREE.Bone();
        rightShoulder.name = 'rightShoulder';
        const rightUpperArm = new THREE.Bone();
        rightUpperArm.name = 'rightUpperArm';
        const rightLowerArm = new THREE.Bone();
        rightLowerArm.name = 'rightLowerArm';
        const rightHand = new THREE.Bone();
        rightHand.name = 'rightHand';

        const leftUpperLeg = new THREE.Bone();
        leftUpperLeg.name = 'leftUpperLeg';
        const leftLowerLeg = new THREE.Bone();
        leftLowerLeg.name = 'leftLowerLeg';
        const leftFoot = new THREE.Bone();
        leftFoot.name = 'leftFoot';

        const rightUpperLeg = new THREE.Bone();
        rightUpperLeg.name = 'rightUpperLeg';
        const rightLowerLeg = new THREE.Bone();
        rightLowerLeg.name = 'rightLowerLeg';
        const rightFoot = new THREE.Bone();
        rightFoot.name = 'rightFoot';

        // Build the tree
        hips.add(spine);
        hips.add(leftUpperLeg);
        hips.add(rightUpperLeg);

        spine.add(chest);
        chest.add(upperChest);
        upperChest.add(neck);
        neck.add(headBone);

        upperChest.add(leftShoulder);
        leftShoulder.add(leftUpperArm);
        leftUpperArm.add(leftLowerArm);
        leftLowerArm.add(leftHand);

        upperChest.add(rightShoulder);
        rightShoulder.add(rightUpperArm);
        rightUpperArm.add(rightLowerArm);
        rightLowerArm.add(rightHand);

        leftUpperLeg.add(leftLowerLeg);
        leftLowerLeg.add(leftFoot);

        rightUpperLeg.add(rightLowerLeg);
        rightLowerLeg.add(rightFoot);

        this.mesh.add(hips);

        this.bones = {
            hips, spine, chest, upperChest, neck, head: headBone,
            leftShoulder, leftUpperArm, leftLowerArm, leftHand,
            rightShoulder, rightUpperArm, rightLowerArm, rightHand,
            leftUpperLeg, leftLowerLeg, leftFoot,
            rightUpperLeg, rightLowerLeg, rightFoot
        };

        const boneArray = Object.values(this.bones);
        this.skeleton = new THREE.Skeleton(boneArray);

        // --- ATTACH VISUAL MESHES TO BONES ---
        // Torso mapping
        this.torso = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        spine.add(this.torso);

        this.neckJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        neck.add(this.neckJoint);

        this.waistJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        hips.add(this.waistJoint);

        this.leftKnee = new THREE.Mesh(jointGeom, this.accentMaterial);
        leftLowerLeg.add(this.leftKnee);

        this.rightKnee = new THREE.Mesh(jointGeom, this.accentMaterial);
        rightLowerLeg.add(this.rightKnee);

        this.leftShoulderJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        leftUpperArm.add(this.leftShoulderJoint);

        this.rightShoulderJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        rightUpperArm.add(this.rightShoulderJoint);

        this.leftElbowJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        leftLowerArm.add(this.leftElbowJoint);

        this.rightElbowJoint = new THREE.Mesh(jointGeom, this.accentMaterial);
        rightLowerArm.add(this.rightElbowJoint);

        this.leftLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftUpperLeg.add(this.leftLeg);

        this.leftLowerLegMesh = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftLowerLeg.add(this.leftLowerLegMesh);

        this.rightLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightUpperLeg.add(this.rightLeg);

        this.rightLowerLegMesh = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightLowerLeg.add(this.rightLowerLegMesh);

        this.shoulders = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        upperChest.add(this.shoulders);

        this.pelvis = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        hips.add(this.pelvis);

        this.leftUpperArm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftUpperArm.add(this.leftUpperArm);

        this.leftForearm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        leftLowerArm.add(this.leftForearm);

        this.rightUpperArm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightUpperArm.add(this.rightUpperArm);

        this.rightForearm = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightLowerArm.add(this.rightForearm);

        /**
         * The head mesh was previously attached to `this.mesh`. 
         * We now attach it directly directly to the root for absolute IK or the `headBone` if driven by forward IK.
         * For now, we will leave it attached to `this.mesh` to preserve the `updatePosture` lerping logic
         * until we fully transition to standard Forward Kinematics.
         */

        const handJointGeom = new THREE.SphereGeometry(0.006, 6, 4);
        const handLimbRadius = 0.003;
        const handCylinderGeom = new THREE.CylinderGeometry(handLimbRadius, handLimbRadius, 1, 4);

        const wristGeom = new THREE.BoxGeometry(0.03, 0.03, 0.03);
        this.wristMeshes = {
            left: new THREE.Mesh(wristGeom, this.accentMaterial),
            right: new THREE.Mesh(wristGeom, this.accentMaterial)
        };
        this.mesh.add(this.wristMeshes.left);
        this.mesh.add(this.wristMeshes.right);
        this.wristMeshes.left.visible = false;
        this.wristMeshes.right.visible = false;

        for (let i = 0; i < 25; i++) {
            const leftJoint = new THREE.Mesh(handJointGeom, this.accentMaterial);
            leftJoint.visible = false;
            this.mesh.add(leftJoint);
            this.handMeshes.left.push(leftJoint);
            const rightJoint = new THREE.Mesh(handJointGeom, this.accentMaterial);
            rightJoint.visible = false;
            this.mesh.add(rightJoint);
            this.handMeshes.right.push(rightJoint);
        }

        for (let i = 0; i < StickFigureHands.HAND_INDICES.length / 2; i++) {
            const leftCyl = new THREE.Mesh(handCylinderGeom, this.cyberMaterial);
            leftCyl.visible = false;
            this.mesh.add(leftCyl);
            this.handCylinders.left.push(leftCyl);
            const rightCyl = new THREE.Mesh(handCylinderGeom, this.cyberMaterial);
            rightCyl.visible = false;
            this.mesh.add(rightCyl);
            this.handCylinders.right.push(rightCyl);
        }
    }

    public applyState(state: IPlayerViewState, delta: number): void {
        const lerpFactor = state.lerpFactor ?? 1.0;
        const skeleton = state.skeleton;
        this.tmpTargetPos.set(
            skeleton.rootWorldPosition.x,
            skeleton.rootWorldPosition.y,
            skeleton.rootWorldPosition.z
        );
        this.tmpTargetQuat.set(
            skeleton.rootWorldQuaternion.x,
            skeleton.rootWorldQuaternion.y,
            skeleton.rootWorldQuaternion.z,
            skeleton.rootWorldQuaternion.w
        );
        if (lerpFactor < 1.0) {
            this.mesh.position.lerp(this.tmpTargetPos, lerpFactor);
            this.mesh.quaternion.slerp(this.tmpTargetQuat, lerpFactor);
        } else {
            this.mesh.position.copy(this.tmpTargetPos);
            this.mesh.quaternion.copy(this.tmpTargetQuat);
        }

        this.rig.applySkeletonPose(skeleton);
        const world = composeAvatarWorldPoses(skeleton);
        const headWorld = world.head;
        if (headWorld) {
            const headLocal = headWorld.position.clone();
            this.mesh.worldToLocal(headLocal);
            const headHeight = Math.max(0.4, headWorld.position.y - skeleton.rootWorldPosition.y);
            this.currentHeadHeight = headHeight;
            this.headMesh.position.set(headLocal.x, headLocal.y, headLocal.z);
            this.headMesh.quaternion.copy(this.mesh.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(headWorld.quaternion.clone()));
        }

        this.hands.updateFromSkeleton('left', skeleton, world, this.mesh, lerpFactor);
        this.hands.updateFromSkeleton('right', skeleton, world, this.mesh, lerpFactor);

        if (state.audioLevel !== undefined) {
            const targetMouthScale = 1.0 + (state.audioLevel * 10.0);
            const animLerp = 0.5;
            this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, targetMouthScale, animLerp);
            if (state.audioLevel < 0.05) {
                this.mouth.scale.y = 1.0;
            }
        }

        this._billboardNameTag();
        if (state.name !== undefined) {
            this.setName(state.name);
        }

        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }
    }

    private _billboardNameTag(): void {
        this.nameTagComponent.faceCamera(this.context.runtime.render?.camera);
    }

    public setColor(color: string | number): void {
        this.color = color;
        const colorObj = new THREE.Color(color as any);
        this.accentMaterial.color.copy(colorObj);
        if (this.headOutline) (this.headOutline.material as THREE.LineBasicMaterial).color.copy(colorObj);
        this.nameTagComponent.setColor(color);
    }

    public setName(name: string): void {
        this.nameTagComponent.setName(this.isLocal ? '' : name);
    }

    private _updateNameTagPosition(): void {
        this.nameTagComponent.updatePosition();
    }

    public getLeftWristMarkerPosition(): THREE.Vector3 {
        return this.hands.getWristMarkerPosition('left');
    }

    public getRightWristMarkerPosition(): THREE.Vector3 {
        return this.hands.getWristMarkerPosition('right');
    }

    public destroy(): void {
        this._cleanupMesh();
        this.voiceAudio.destroy();

        this.mesh.traverse((object) => {
            const mesh = object as THREE.Mesh;
            if (mesh.isMesh || (object as any).isLine || (object as any).isLineSegments) {
                if (mesh.geometry) mesh.geometry.dispose();
                if (mesh.material) {
                    if (Array.isArray(mesh.material)) {
                        mesh.material.forEach(mat => mat.dispose());
                    } else {
                        mesh.material.dispose();
                    }
                }
            }
        });
        this.nameTagComponent.destroy();
    }
}
