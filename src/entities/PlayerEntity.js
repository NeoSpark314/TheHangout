import { NetworkEntity } from './NetworkEntity.js';
import * as THREE from 'three';

/**
 * Base class for players in the world, sharing common data structures
 * for VR tracking states like head and hands.
 */
export class PlayerEntity extends NetworkEntity {
    constructor(id, type, isAuthority) {
        super(id, type, isAuthority);

        this.neckHeight = 0.6;
        this.worldYaw = 0;

        this.headState = {
            position: new THREE.Vector3(0, 0.8, 0),
            quaternion: new THREE.Quaternion()
        };

        this.handStates = {
            left: { active: false, position: new THREE.Vector3(-0.4, 0, 0), quaternion: new THREE.Quaternion() },
            right: { active: false, position: new THREE.Vector3(0.4, 0, 0), quaternion: new THREE.Quaternion() }
        };
    }
}
