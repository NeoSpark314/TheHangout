import * as THREE from 'three';
import { EntityView } from './EntityView';
import { IVector3, IQuaternion } from '../interfaces/IMath';
import { IHandState } from '../interfaces/ITrackingProvider';
import { GameContext } from '../core/GameState';

export interface IPlayerViewState {
    position: IVector3;
    yaw: number;
    headHeight: number;
    headQuaternion: IQuaternion;
    handStates: { left: IHandState, right: IHandState };
    name?: string;
    color?: string | number;
    isLocal?: boolean;
    audioLevel?: number;
    lerpFactor?: number;
}

export class StickFigureView extends EntityView<IPlayerViewState> {
    public color: string | number;
    public isLocal: boolean;
    public headMesh!: THREE.Mesh;
    private currentHeadHeight: number = 1.7;
    private _lastName: string = '';

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
    private shoulders!: THREE.Mesh;
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
    private nameTag: THREE.Sprite | null = null;

    static HAND_INDICES = [
        0, 1, 1, 2, 2, 3, 3, 4,
        0, 5, 5, 6, 6, 7, 7, 8, 8, 9,
        0, 10, 10, 11, 11, 12, 12, 13, 13, 14,
        0, 15, 15, 16, 16, 17, 17, 18, 18, 19,
        0, 20, 20, 21, 21, 22, 22, 23, 23, 24
    ];

    private positionalAudio: THREE.PositionalAudio | null = null;
    private audioAnalyser: THREE.AudioAnalyser | null = null;
    private audioElement: HTMLAudioElement | null = null;
    private mediaSource: MediaSource | null = null;
    private sourceBuffer: SourceBuffer | null = null;
    private bufferQueue: Uint8Array[] = [];
    private manuallyMuted: boolean = false;

    constructor(private context: GameContext, { color = 0x00ffff, isLocal = false }: { color?: string | number, isLocal?: boolean } = {}) {
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
        this._setupAudio();
    }

    private _setupAudio(): void {
        const render = this.context.managers.render;
        if (render?.audioListener) {
            this.positionalAudio = new THREE.PositionalAudio(render.audioListener);
            this.positionalAudio.setRefDistance(3);
            this.positionalAudio.setRolloffFactor(1.0);
            this.positionalAudio.setDistanceModel('exponential');
            // Attach audio to the head so it comes from their mouth
            this.headMesh.add(this.positionalAudio);
        }
    }

    public attachVoiceStream(stream: MediaStream): void {
        if (this.positionalAudio) {
            try {
                if (!this.audioElement) {
                    this.audioElement = new Audio();
                    this.audioElement.muted = this.manuallyMuted || true; // Native stream starts muted unless explicitly allowed
                }
                this.audioElement.srcObject = stream;
                this.audioElement.play().catch(e => console.warn('[StickFigureView] Auto-play blocked for hidden audio:', e));

                this.positionalAudio.setMediaStreamSource(stream);

                // Setup analyser for mouth animation
                this.audioAnalyser = new THREE.AudioAnalyser(this.positionalAudio, 32);
            } catch (e) {
                console.error('[StickFigureView] Failed to set media stream source:', e);
            }
        }
    }

    public attachAudioChunk(data: { chunk: string, isHeader: boolean } | string): void {
        if (!this.positionalAudio) return;

        let base64Chunk: string;
        let isHeader = false;

        if (typeof data === 'string') {
            base64Chunk = data;
        } else {
            base64Chunk = data.chunk;
            isHeader = data.isHeader;
        }

        // If we get a header and we already have a media source, it means the stream was restarted.
        // We MUST re-create the media source to start fresh with the new header.
        if (isHeader && this.mediaSource) {
            console.log('[StickFigureView] New audio header received, resetting MediaSource.');
            this.cleanupAudioSource();
        }

        if (!this.mediaSource) {
            this.mediaSource = new MediaSource();
            if (!this.audioElement) {
                this.audioElement = new Audio();
                this.audioElement.autoplay = true;
                this.audioElement.muted = this.manuallyMuted;
            }

            const blobUrl = URL.createObjectURL(this.mediaSource);
            this.audioElement.src = blobUrl;
            // Removed premature play() call that was causing NotSupportedError

            if (!this.audioAnalyser) {
                console.log(`[StickFigureView] Connecting AudioElement to PositionalAudio for ${this.isLocal ? 'local' : 'remote'} player`);
                this.positionalAudio.setMediaElementSource(this.audioElement as HTMLMediaElement);
                this.audioAnalyser = new THREE.AudioAnalyser(this.positionalAudio, 32);
            }

            this.mediaSource.addEventListener('sourceopen', () => {
                const mimeTypes = [
                    'audio/webm;codecs=opus',
                    'audio/webm',
                    'audio/mpeg'
                ];
                let selectedMime = '';
                for (const mime of mimeTypes) {
                    if (MediaSource.isTypeSupported(mime)) {
                        selectedMime = mime;
                        break;
                    }
                }

                if (selectedMime) {
                    console.log(`[StickFigureView] MediaSource opened. Adding SourceBuffer for: ${selectedMime}`);
                    this.sourceBuffer = this.mediaSource!.addSourceBuffer(selectedMime);
                    this.sourceBuffer.mode = 'sequence'; // CRITICAL: ignore container timestamps for live relay
                    this.sourceBuffer.addEventListener('updateend', () => this.processAudioQueue());
                    this.processAudioQueue();
                } else {
                    console.error('[StickFigureView] No supported MIME type found for MediaSource');
                }
            });
        }

        try {
            const binaryStr = atob(base64Chunk);
            const bytes = new Uint8Array(binaryStr.length);
            for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
            }

            this.bufferQueue.push(bytes);
            if (this.sourceBuffer && !this.sourceBuffer.updating) {
                this.processAudioQueue();
            }
        } catch (e) { /* ignore parse error */ }
    }

    private cleanupAudioSource(): void {
        if (this.mediaSource) {
            if (this.mediaSource.readyState === 'open' && this.sourceBuffer) {
                try {
                    if (this.sourceBuffer.updating) {
                        this.sourceBuffer.abort();
                    }
                    this.mediaSource.removeSourceBuffer(this.sourceBuffer);
                } catch (e) {
                    console.warn('[StickFigureView] Error removing SourceBuffer:', e);
                }
            }
            this.mediaSource = null;
            this.sourceBuffer = null;
            this.bufferQueue = [];
        }
        if (this.audioElement) {
            this.audioElement.pause();
            const oldSrc = this.audioElement.src;
            this.audioElement.src = '';
            this.audioElement.removeAttribute('src');
            this.audioElement.load();
            if (oldSrc && oldSrc.startsWith('blob:')) {
                URL.revokeObjectURL(oldSrc);
            }
        }
    }

    private processAudioQueue(): void {
        const canAppend = this.mediaSource &&
            this.mediaSource.readyState === 'open' &&
            this.sourceBuffer &&
            !this.sourceBuffer.updating &&
            this.bufferQueue.length > 0;

        if (!canAppend) return;

        // Final safety check: is this source buffer still attached?
        let isAttached = false;
        try {
            for (let i = 0; i < this.mediaSource!.sourceBuffers.length; i++) {
                if (this.mediaSource!.sourceBuffers[i] === this.sourceBuffer) {
                    isAttached = true;
                    break;
                }
            }
        } catch (e) { isAttached = false; }

        if (!isAttached) {
            this.sourceBuffer = null;
            return;
        }

        const chunk = this.bufferQueue.shift()!;
        try {
            this.sourceBuffer!.appendBuffer(chunk as any);
        } catch (e) {
            console.error('[StickFigureView] Error appending buffer:', e);
            // If we get an error, it might be an invalid state, clear the queue to avoid spin loops
            this.bufferQueue = [];
        }

        if (this.audioElement) {
            const buffered = this.audioElement.buffered;
            if (buffered.length > 0) {
                const end = buffered.end(buffered.length - 1);

                // Small catch-up threshold to reduce latency while preventing choppy audio
                if (end - this.audioElement.currentTime > 0.5) {
                    this.audioElement.currentTime = end - 0.1;
                }

                if (this.audioElement.paused) {
                    this.audioElement.play().catch(err => {
                        console.warn('[StickFigureView] Auto-play failed:', err);
                    });
                }
            }
        }
    }

    public setMuted(muted: boolean): void {
        this.manuallyMuted = muted;
        if (this.audioElement) {
            this.audioElement.muted = muted;
        }
    }

    public getAudioLevel(): number {
        return this.audioAnalyser ? this.audioAnalyser.getAverageFrequency() / 128.0 : 0;
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
        const materials = [this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, this.darkMaterial, faceMaterial];

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
        this.leftEye.position.set(-0.07, headSize * 0.7, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.leftEye);
        this.rightEye = new THREE.Mesh(eyeGeom, this.featureMaterial);
        this.rightEye.position.set(0.07, headSize * 0.7, -(headDepth / 2 + 0.01));
        this.headMesh.add(this.rightEye);

        const mouthGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 8);
        mouthGeom.rotateZ(Math.PI / 2);
        mouthGeom.rotateX(Math.PI / 2);
        this.mouth = new THREE.Mesh(mouthGeom, this.featureMaterial);
        this.mouth.position.set(0, headSize * 0.3, -(headDepth / 2 + 0.01));
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
        chest.add(neck);
        neck.add(headBone);

        chest.add(leftShoulder);
        leftShoulder.add(leftUpperArm);
        leftUpperArm.add(leftLowerArm);
        leftLowerArm.add(leftHand);

        chest.add(rightShoulder);
        rightShoulder.add(rightUpperArm);
        rightUpperArm.add(rightLowerArm);
        rightLowerArm.add(rightHand);

        leftUpperLeg.add(leftLowerLeg);
        leftLowerLeg.add(leftFoot);

        rightUpperLeg.add(rightLowerLeg);
        rightLowerLeg.add(rightFoot);

        this.mesh.add(hips);

        this.bones = {
            hips, spine, chest, neck, head: headBone,
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

        this.rightLeg = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        rightUpperLeg.add(this.rightLeg);

        this.shoulders = new THREE.Mesh(cylinderGeom, this.cyberMaterial);
        chest.add(this.shoulders);

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

        for (let i = 0; i < StickFigureView.HAND_INDICES.length / 2; i++) {
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

        if (state.position) {
            const targetPos = new THREE.Vector3(state.position.x, state.position.y, state.position.z);
            if (lerpFactor < 1.0) {
                this.mesh.position.lerp(targetPos, lerpFactor);
            } else {
                this.mesh.position.copy(targetPos);
            }
        }

        if (state.yaw !== undefined) {
            if (lerpFactor < 1.0) {
                const targetQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, state.yaw, 0, 'YXZ'));
                this.mesh.quaternion.slerp(targetQuat, lerpFactor);
            } else {
                this.mesh.rotation.y = state.yaw;
            }
        }

        if (state.headHeight !== undefined) {
            const height = lerpFactor < 1.0
                ? THREE.MathUtils.lerp(this.currentHeadHeight, state.headHeight, lerpFactor)
                : state.headHeight;
            this.updatePosture(height);
        }

        if (state.headQuaternion) {
            // Incoming quaternion is world space. To make the mesh rotate correctly relative to parent:
            const worldHeadQuat = new THREE.Quaternion(state.headQuaternion.x, state.headQuaternion.y, state.headQuaternion.z, state.headQuaternion.w);
            const parentWorldQuat = new THREE.Quaternion();
            this.mesh.getWorldQuaternion(parentWorldQuat);
            const localHeadQuat = parentWorldQuat.invert().multiply(worldHeadQuat);

            if (lerpFactor < 1.0) {
                this.headMesh.quaternion.slerp(localHeadQuat, lerpFactor);
            } else {
                this.headMesh.quaternion.copy(localHeadQuat);
            }
        }

        if (state.handStates) {
            // Logic works in WORLD SPACE, but rendering needs LOCAL SPACE relative to this.mesh (the avatar origin)
            // Ensure world matrix is up to date since we just potentially moved this.mesh
            this.mesh.updateMatrixWorld(true);

            this.updateWristMarkers(state.handStates.left, state.handStates.right, lerpFactor);

            const leftArmLocalPos = state.handStates.left.active && (state.handStates.left.hasJoints || this.wristMeshes.left.visible)
                ? this.getLeftWristMarkerPosition()
                : new THREE.Vector3(-0.25, 0.7, -0.05);
            const rightArmLocalPos = state.handStates.right.active && (state.handStates.right.hasJoints || this.wristMeshes.right.visible)
                ? this.getRightWristMarkerPosition()
                : new THREE.Vector3(0.25, 0.7, -0.05);
            this.updateArms(leftArmLocalPos, rightArmLocalPos);
        }

        if (state.audioLevel !== undefined) {
            const targetMouthScale = 1.0 + (state.audioLevel * 10.0);
            const animLerp = 0.5;
            this.mouth.scale.y = THREE.MathUtils.lerp(this.mouth.scale.y, targetMouthScale, animLerp);
            if (state.audioLevel < 0.05) {
                this.mouth.scale.y = 1.0;
            }
        }

        this._billboardNameTag();
        if (state.name !== undefined && state.name !== this._lastName) {
            this._lastName = state.name;
            this.setName(state.name);
        }

        if (state.color !== undefined && state.color !== this.color) {
            this.setColor(state.color);
        }
    }

    private _billboardNameTag(): void {
        // Sprites billboard automatically in Three.js, no manual rotation needed.
    }

    private _alignCylinder(mesh: THREE.Mesh, start: THREE.Vector3, end: THREE.Vector3, radius: number = 0.02): void {
        const dir = new THREE.Vector3().subVectors(end, start);
        const len = dir.length();
        if (len < 0.001) {
            mesh.scale.set(0, 0, 0);
            return;
        }
        mesh.scale.set(1, len, 1);
        mesh.position.copy(start).addScaledVector(dir, 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }

    public setColor(color: string | number): void {
        this.color = color;
        const colorObj = new THREE.Color(color as any);
        this.accentMaterial.color.copy(colorObj);
        if (this.headOutline) (this.headOutline.material as THREE.LineBasicMaterial).color.copy(colorObj);
        if (this.nameTag && this._lastName) {
            this.setName(this._lastName);
        }
    }

    public setName(name: string): void {
        if (!name) {
            if (this.nameTag) {
                this.mesh.remove(this.nameTag);
                if (this.nameTag.material.map) {
                    this.nameTag.material.map.dispose();
                }
                this.nameTag.material.dispose();
                this.nameTag = null;
            }
            return;
        }

        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d')!;
        canvas.width = 512;
        canvas.height = 128;

        // Background
        context.fillStyle = 'rgba(0, 0, 0, 0.6)';
        const radius = 30;
        context.beginPath();
        context.moveTo(radius, 0);
        context.lineTo(canvas.width - radius, 0);
        context.quadraticCurveTo(canvas.width, 0, canvas.width, radius);
        context.lineTo(canvas.width, canvas.height - radius);
        context.quadraticCurveTo(canvas.width, canvas.height, canvas.width - radius, canvas.height);
        context.lineTo(radius, canvas.height);
        context.quadraticCurveTo(0, canvas.height, 0, canvas.height - radius);
        context.lineTo(0, radius);
        context.quadraticCurveTo(0, 0, radius, 0);
        context.closePath();
        context.fill();

        context.font = 'bold 70px Inter, Arial, sans-serif';
        context.textAlign = 'center';
        context.textBaseline = 'middle';

        const fillStyle = typeof this.color === 'string' && this.color.startsWith('#')
            ? this.color
            : '#' + (this.color as number).toString(16).padStart(6, '0');

        context.fillStyle = fillStyle;
        context.shadowColor = 'rgba(0, 0, 0, 0.9)';
        context.shadowBlur = 6;
        context.fillText(name.toUpperCase(), canvas.width / 2, canvas.height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const spriteMaterial = new THREE.SpriteMaterial({ map: texture, transparent: true });

        if (this.nameTag) {
            const oldMap = this.nameTag.material.map;
            this.nameTag.material = spriteMaterial;
            if (oldMap) oldMap.dispose();
        } else {
            this.nameTag = new THREE.Sprite(spriteMaterial);
            this.nameTag.scale.set(1.0, 0.25, 1.0);
            this.mesh.add(this.nameTag);
        }
        this._updateNameTagPosition();
    }

    private _updateNameTagPosition(): void {
        if (this.nameTag) {
            this.nameTag.position.y = this.headMesh.position.y + 0.45;
        }
    }

    public updatePosture(headHeight: number): void {
        this.currentHeadHeight = headHeight;

        // --- 1. Position the IK Root Bones ---
        const neckHeight = Math.max(0.4, headHeight - 0.2);
        this.headMesh.position.y = neckHeight;

        const waistHeight = neckHeight * 0.55;
        this.bones.hips.position.set(0, waistHeight, 0);

        // Scale visual limbs (their centers are 0,0,0, stretching from -0.5 to 0.5)
        // Since they are children of bones now, we don't move their absolute positions,
        // we scale them to fill the gap to the next bone.

        const spineLength = neckHeight - waistHeight;
        this.bones.spine.position.set(0, 0, 0);
        this.bones.chest.position.set(0, spineLength * 0.5, 0);
        this.bones.neck.position.set(0, spineLength * 0.5, 0);

        this._setupLocalCylinder(this.torso, spineLength);
        this.torso.position.set(0, spineLength * 0.5, 0); // shift mesh up relative to hip

        const shoulderWidth = 0.5;
        this.bones.leftShoulder.position.set(-shoulderWidth / 2, 0, 0);
        this.bones.rightShoulder.position.set(shoulderWidth / 2, 0, 0);

        // The visual bar connecting shoulders
        this._setupLocalCylinder(this.shoulders, shoulderWidth);
        this.shoulders.rotation.z = Math.PI / 2;

        const legLength = waistHeight;
        const upperLegLength = legLength * 0.5;
        const lowerLegLength = legLength * 0.5;

        this.bones.leftUpperLeg.position.set(-0.2, 0, 0);
        this.bones.leftLowerLeg.position.set(0, -upperLegLength, 0);
        this._setupLocalCylinder(this.leftLeg, upperLegLength);
        this.leftLeg.position.set(0, -upperLegLength * 0.5, 0);

        this.bones.rightUpperLeg.position.set(0.2, 0, 0);
        this.bones.rightLowerLeg.position.set(0, -upperLegLength, 0);
        this._setupLocalCylinder(this.rightLeg, upperLegLength);
        this.rightLeg.position.set(0, -upperLegLength * 0.5, 0);

        this._updateNameTagPosition();
    }

    private _setupLocalCylinder(mesh: THREE.Mesh, length: number) {
        if (length < 0.001) {
            mesh.scale.set(0, 0, 0);
        } else {
            mesh.scale.set(1, length, 1);
        }
    }

    public updateArms(leftHandPos: THREE.Vector3, rightHandPos: THREE.Vector3): void {
        const calculateIK = (shoulderBone: THREE.Bone, handWorldTarget: THREE.Vector3, isLeft: boolean): { upperQuat: THREE.Quaternion, lowerQuat: THREE.Quaternion, elbowDist: number, wristDist: number } => {
            // Get local target relative to the shoulder bone
            shoulderBone.updateMatrixWorld();
            const invShoulderMat = new THREE.Matrix4().copy(shoulderBone.matrixWorld).invert();
            const targetLocal = handWorldTarget.clone().applyMatrix4(invShoulderMat);

            const targetDist = targetLocal.length();
            const armDir = targetLocal.clone().normalize();

            // Segment lengths
            const upperArmLen = 0.32;
            const lowerArmLen = 0.32;

            // Basic CCD / Triangle IK math to find the elbow bend angle
            // Law of Cosines to find the angle at the shoulder
            let cosAngle = (upperArmLen * upperArmLen + targetDist * targetDist - lowerArmLen * lowerArmLen) / (2 * upperArmLen * targetDist);
            cosAngle = Math.max(-1, Math.min(1, cosAngle));
            const shoulderAngle = Math.acos(cosAngle);

            // Pole vector (hint for elbow direction: slightly outward and down)
            const side = isLeft ? 1 : -1;
            const poleLocal = new THREE.Vector3(side * 0.5, -0.5, 0.2).normalize();

            // Find an axis perpendicular to the arm direction and pole to bend around
            const bendAxis = new THREE.Vector3().crossVectors(poleLocal, armDir).normalize();

            // If the arm is stretched out straight, the cross product is zero
            if (bendAxis.lengthSq() < 0.001) { bendAxis.set(0, 0, 1); }

            // Apply rotation from straight-down (0,-1,0) towards the target
            const baseQuat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), armDir);

            // Add the bend angle
            const bendQuat = new THREE.Quaternion().setFromAxisAngle(bendAxis, shoulderAngle);
            const upperQuat = baseQuat.multiply(bendQuat);

            // Now solve the elbow (lower arm)
            let lowerCosAngle = (upperArmLen * upperArmLen + lowerArmLen * lowerArmLen - targetDist * targetDist) / (2 * upperArmLen * lowerArmLen);
            lowerCosAngle = Math.max(-1, Math.min(1, lowerCosAngle));
            const elbowAngle = Math.PI - Math.acos(lowerCosAngle);

            // Elbow bends around the same local bendAxis, just relative to the straight arm
            const lowerQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), elbowAngle); // Actually depends on the skeleton rest binding!

            return { upperQuat, lowerQuat, elbowDist: upperArmLen, wristDist: lowerArmLen };
        };

        const leftIk = calculateIK(this.bones.leftShoulder, leftHandPos, true);
        this.bones.leftUpperArm.quaternion.copy(leftIk.upperQuat);
        // Place lower arm at the end of upper arm
        this.bones.leftLowerArm.position.set(0, -leftIk.elbowDist, 0);
        this.bones.leftLowerArm.quaternion.copy(leftIk.lowerQuat);

        this._setupLocalCylinder(this.leftUpperArm, leftIk.elbowDist);
        this.leftUpperArm.position.set(0, -leftIk.elbowDist * 0.5, 0);
        this._setupLocalCylinder(this.leftForearm, leftIk.wristDist);
        this.leftForearm.position.set(0, -leftIk.wristDist * 0.5, 0);


        const rightIk = calculateIK(this.bones.rightShoulder, rightHandPos, false);
        this.bones.rightUpperArm.quaternion.copy(rightIk.upperQuat);
        this.bones.rightLowerArm.position.set(0, -rightIk.elbowDist, 0);
        this.bones.rightLowerArm.quaternion.copy(rightIk.lowerQuat);

        this._setupLocalCylinder(this.rightUpperArm, rightIk.elbowDist);
        this.rightUpperArm.position.set(0, -rightIk.elbowDist * 0.5, 0);
        this._setupLocalCylinder(this.rightForearm, rightIk.wristDist);
        this.rightForearm.position.set(0, -rightIk.wristDist * 0.5, 0);
    }

    public updateWristMarkers(leftHandInfo: IHandState, rightHandInfo: IHandState, lerpFactor: number = 1.0): void {
        const inverseWorldQuat = new THREE.Quaternion();
        this.mesh.getWorldQuaternion(inverseWorldQuat).invert();

        this._updateHand('left', leftHandInfo, inverseWorldQuat, lerpFactor);
        this._updateHand('right', rightHandInfo, inverseWorldQuat, lerpFactor);
    }

    private _updateHand(hand: 'left' | 'right', handInfo: IHandState, inverseWorldQuat: THREE.Quaternion, lerpFactor: number): void {
        const hasJoints = handInfo.active && handInfo.hasJoints;

        // 1. Update Wrist Marker (Cube)
        if (!handInfo.active || hasJoints) {
            this.wristMeshes[hand].visible = false;
        } else {
            this.wristMeshes[hand].visible = true;
            const worldPos = new THREE.Vector3(handInfo.pose.position.x, handInfo.pose.position.y, handInfo.pose.position.z);
            const worldQuat = new THREE.Quaternion(handInfo.pose.quaternion.x, handInfo.pose.quaternion.y, handInfo.pose.quaternion.z, handInfo.pose.quaternion.w);

            const localPos = this.mesh.worldToLocal(worldPos);
            const localQuat = inverseWorldQuat.clone().multiply(worldQuat);

            this.wristMeshes[hand].position.lerp(localPos, lerpFactor);
            this.wristMeshes[hand].quaternion.slerp(localQuat, lerpFactor);
        }

        // 2. Update Hand Joints
        for (let i = 0; i < 25; i++) {
            if (hasJoints) {
                this.handMeshes[hand][i].visible = true;
                const jointPose = handInfo.joints[i].pose;
                const worldPos = new THREE.Vector3(jointPose.position.x, jointPose.position.y, jointPose.position.z);
                const worldQuat = new THREE.Quaternion(jointPose.quaternion.x, jointPose.quaternion.y, jointPose.quaternion.z, jointPose.quaternion.w);

                const localPos = this.mesh.worldToLocal(worldPos);
                const localQuat = inverseWorldQuat.clone().multiply(worldQuat);

                this.handMeshes[hand][i].position.lerp(localPos, lerpFactor);
                this.handMeshes[hand][i].quaternion.slerp(localQuat, lerpFactor);
            } else {
                this.handMeshes[hand][i].visible = false;
            }
        }

        // 3. Update Hand Skeleton
        this._updateHandSkeleton(hand, hasJoints);
    }

    private _updateHandSkeleton(hand: 'left' | 'right', hasJoints: boolean): void {
        const cylinders = this.handCylinders[hand];
        if (!hasJoints) {
            cylinders.forEach(c => c.visible = false);
            return;
        }
        for (let i = 0; i < cylinders.length; i++) {
            const startIdx = StickFigureView.HAND_INDICES[i * 2];
            const endIdx = StickFigureView.HAND_INDICES[i * 2 + 1];
            const startJoint = this.handMeshes[hand][startIdx];
            const endJoint = this.handMeshes[hand][endIdx];
            cylinders[i].visible = true;
            this._alignCylinder(cylinders[i], startJoint.position, endJoint.position, 0.003);
        }
    }

    public getLeftWristMarkerPosition(): THREE.Vector3 {
        return this.handMeshes.left[0].visible ? this.handMeshes.left[0].position : this.wristMeshes.left.position;
    }

    public getRightWristMarkerPosition(): THREE.Vector3 {
        return this.handMeshes.right[0].visible ? this.handMeshes.right[0].position : this.wristMeshes.right.position;
    }

    public destroy(): void {
        this._cleanupMesh();
        this.cleanupAudioSource();
        this.audioElement = null;

        if (this.positionalAudio) {
            try {
                if (this.positionalAudio.hasPlaybackControl) {
                    this.positionalAudio.stop();
                }
                if (this.positionalAudio.source) {
                    this.positionalAudio.disconnect();
                }
            } catch (e) {
                // Ignore disconnect errors
            }
            this.headMesh.remove(this.positionalAudio);
        }

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
        if (this.nameTag) {
            if (this.nameTag.material.map) this.nameTag.material.map.dispose();
            this.nameTag.material.dispose();
        }
    }
}
