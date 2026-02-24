import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PhysicsEntity } from '../PhysicsEntity.js';
import * as THREE from 'three';

// Mock Three.js
vi.mock('three', () => {
    const Vector3 = vi.fn().mockImplementation(() => ({
        set: vi.fn().mockReturnThis(),
        copy: vi.fn().mockReturnThis(),
        distanceToSquared: vi.fn().mockReturnValue(0),
        add: vi.fn().mockReturnThis(),
        lerp: vi.fn().mockReturnThis(),
        clone: vi.fn().mockImplementation(() => ({
            set: vi.fn().mockReturnThis(),
            distanceToSquared: vi.fn().mockReturnValue(0)
        }))
    }));
    const Quaternion = vi.fn().mockImplementation(() => ({
        set: vi.fn().mockReturnThis(),
        copy: vi.fn().mockReturnThis(),
        angleTo: vi.fn().mockReturnValue(0),
        slerp: vi.fn().mockReturnThis()
    }));
    return {
        Vector3,
        Quaternion,
        Mesh: vi.fn().mockImplementation(() => ({
            position: new Vector3(),
            quaternion: new Quaternion()
        }))
    };
});

// Mock Rapier
vi.mock('@dimforge/rapier3d-compat', () => ({
    default: {
        RigidBodyType: {
            Dynamic: 0,
            KinematicPositionBased: 1
        }
    }
}));

// Mock GameState
vi.mock('../../core/GameState.js', () => ({
    default: {
        isHost: true,
        localPlayer: { id: 'local-123' },
        managers: {
            network: {
                sendData: vi.fn()
            }
        }
    }
}));

describe('PhysicsEntity', () => {
    let mockMesh;
    let mockRigidBody;

    beforeEach(() => {
        mockMesh = new THREE.Mesh();
        mockRigidBody = {
            translation: vi.fn().mockReturnValue({ x: 1, y: 2, z: 3 }),
            rotation: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, w: 1 }),
            linvel: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
            angvel: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0 }),
            setTranslation: vi.fn(),
            setRotation: vi.fn(),
            setLinvel: vi.fn(),
            setAngvel: vi.fn(),
            bodyType: vi.fn().mockReturnValue(0),
            isSleeping: vi.fn().mockReturnValue(false),
            wakeUp: vi.fn(),
            setBodyType: vi.fn()
        };
    });

    it('should initialize with correct id and type', () => {
        const entity = new PhysicsEntity('prop-1', true, mockRigidBody, { view: { mesh: mockMesh } });
        expect(entity.id).toBe('prop-1');
        expect(entity.type).toBe('PHYSICS_PROP');
    });

    it('should serialize network state correctly', () => {
        const entity = new PhysicsEntity('prop-1', true, mockRigidBody, { view: { mesh: mockMesh } });
        const state = entity.getNetworkState();

        expect(state.p).toEqual([1, 2, 3]);
        expect(state.q).toEqual([0, 0, 0, 1]);
        expect(state.v).toEqual([0, 0, 0]);
    });

    it('should handle authority changes', () => {
        const entity = new PhysicsEntity('prop-1', true, mockRigidBody, { view: { mesh: mockMesh } });
        expect(entity.isAuthority).toBe(true);

        // Mock losing authority
        entity.onAuthorityChanged(false);
        entity.ownerId = 'remote-123';
        expect(entity.isAuthority).toBe(false);
        expect(entity.ownerId).toBe('remote-123');
    });
});
