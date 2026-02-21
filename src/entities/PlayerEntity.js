import { NetworkEntity } from './NetworkEntity.js';
import * as THREE from 'three';

/**
 * Base class for players in the world, sharing common data structures
 * for VR tracking states like head and hands.
 */
export class PlayerEntity extends NetworkEntity {
    constructor(id, type, isAuthority) {
        super(id, type, isAuthority);

        this.name = '';
        this.headHeight = 1.7;

        this.headState = {
            position: new THREE.Vector3(0, 0.8, 0),
            quaternion: new THREE.Quaternion()
        };

        const createHandState = (offsetX) => {
            const state = {
                active: false,
                position: new THREE.Vector3(offsetX, 0, 0),
                quaternion: new THREE.Quaternion(),
                joints: []
            };
            for (let i = 0; i < 25; i++) {
                state.joints.push({
                    position: new THREE.Vector3(),
                    quaternion: new THREE.Quaternion()
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
