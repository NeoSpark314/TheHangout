import * as THREE from 'three';
import type { AppContext } from '../../app/AppContext';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';

type TransitionPhase = 'idle' | 'disappearing' | 'appearing';

const TRANSITION_VERTEX_SHADER = `
uniform vec3 uHeadWorld;
uniform float uWarp;
uniform float uInfinityDistance;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vSourceWorldPos;
varying float vWarp;

void main() {
    vec3 transformedPos = position;
    vec4 worldPos = modelMatrix * vec4(transformedPos, 1.0);
    vec3 sourceWorldPos = worldPos.xyz;
    vec3 toWorld = worldPos.xyz - uHeadWorld;
    float distanceToHead = max(length(toWorld), 0.0001);
    vec3 direction = toWorld / distanceToHead;

    // Pull distant surfaces further so the space converges toward the headset center.
    float distanceBoost = mix(0.35, 1.0, clamp(distanceToHead / 8.0, 0.0, 1.0));
    worldPos.xyz += direction * (uWarp * uInfinityDistance * distanceBoost);

    vWorldPos = worldPos.xyz;
    vSourceWorldPos = sourceWorldPos;
    vWarp = uWarp;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const TRANSITION_FRAGMENT_SHADER = `
uniform vec3 uHeadWorld;
uniform float uRevealRadiusMax;
uniform float uTime;
varying vec3 vWorldPos;
varying vec3 vSourceWorldPos;
varying float vWarp;

float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
}

void main() {
    float noise = hash13(vWorldPos * 0.6 + vec3(uTime * 0.25));
    float distanceToHead = length(vSourceWorldPos - uHeadWorld);
    float cutoffRadius = vWarp * uRevealRadiusMax;
    float edgeNoise = (hash13(vSourceWorldPos * 0.35 + vec3(uTime * 0.17)) - 0.5) * 2.0;
    float edgeWidth = 1.4;
    if (distanceToHead < (cutoffRadius + edgeNoise * edgeWidth)) discard;

    float pulse = 0.5 + 0.5 * sin(uTime * 8.0 + length(vWorldPos) * 0.8);
    float shimmer = mix(0.75, 1.25, noise) * mix(0.85, 1.15, pulse);
    vec3 base = vec3(0.08, 0.90, 0.95);
    vec3 accent = vec3(0.95, 0.98, 1.0);
    vec3 color = mix(base, accent, clamp(vWarp * 0.8 + noise * 0.25, 0.0, 1.0)) * shimmer;

    float alpha = clamp(1.0 - smoothstep(0.82, 1.0, vWarp), 0.0, 1.0);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(color, alpha);
}
`;

export class WorldTransitionRuntime implements IUpdatable {
    private readonly transitionDurationSec = 1.0;
    private readonly switchHiddenDelaySec = 0.06;
    private readonly infinityDistance = 90.0;
    private readonly revealRadiusMax = 34.0;
    private phase: TransitionPhase = 'idle';
    private phaseTimeSec = 0;
    private totalTimeSec = 0;
    private pendingSwitch: (() => void) | null = null;
    private switchTriggered = false;
    private readonly transitionMaterial: THREE.ShaderMaterial;

    constructor(private readonly context: AppContext) {
        this.transitionMaterial = new THREE.ShaderMaterial({
            uniforms: {
                uHeadWorld: { value: new THREE.Vector3() },
                uWarp: { value: 0.0 },
                uInfinityDistance: { value: this.infinityDistance },
                uRevealRadiusMax: { value: this.revealRadiusMax },
                uTime: { value: 0.0 }
            },
            vertexShader: TRANSITION_VERTEX_SHADER,
            fragmentShader: TRANSITION_FRAGMENT_SHADER,
            transparent: true,
            depthTest: true,
            depthWrite: false,
            fog: false,
            skinning: true,
            morphTargets: true,
            side: THREE.DoubleSide
        });

        eventBus.on(EVENTS.XR_SESSION_STARTED, () => {
            this.playAppearTransition();
        });
    }

    public update(delta: number): void {
        this.totalTimeSec += delta;
        const render = this.context.runtime.render;
        if (!render) return;

        const headWorld = this.transitionMaterial.uniforms.uHeadWorld.value as THREE.Vector3;
        render.camera.getWorldPosition(headWorld);
        this.transitionMaterial.uniforms.uTime.value = this.totalTimeSec;

        if (this.phase === 'idle') {
            return;
        }

        this.phaseTimeSec += delta;
        const t = Math.min(1, this.phaseTimeSec / this.transitionDurationSec);
        if (this.phase === 'disappearing') {
            this.transitionMaterial.uniforms.uWarp.value = t;
            if (!this.switchTriggered && t >= 1) {
                this.switchTriggered = true;
                const switchNow = this.pendingSwitch;
                this.pendingSwitch = null;
                switchNow?.();
                this.phase = 'appearing';
                this.phaseTimeSec = -this.switchHiddenDelaySec;
                this.playTransitionSound('appear');
            }
            return;
        }

        this.transitionMaterial.uniforms.uWarp.value = 1 - t;
        if (t >= 1) {
            this.endTransition();
        }
    }

    public transitionScenario(switchWorld: () => void): void {
        const scene = this.context.runtime.render?.scene;
        if (!scene) {
            switchWorld();
            return;
        }

        if (this.phase !== 'idle') {
            // Avoid deadlocks on overlapping switch requests.
            switchWorld();
            return;
        }

        this.pendingSwitch = switchWorld;
        this.switchTriggered = false;
        this.phase = 'disappearing';
        this.phaseTimeSec = 0;
        this.bindOverrideMaterial();
        this.transitionMaterial.uniforms.uWarp.value = 0.0;
        this.playTransitionSound('disappear');
    }

    public playAppearTransition(): void {
        if (this.phase !== 'idle') return;
        this.phase = 'appearing';
        this.phaseTimeSec = 0;
        this.bindOverrideMaterial();
        this.transitionMaterial.uniforms.uWarp.value = 1.0;
        this.playTransitionSound('appear');
    }

    private bindOverrideMaterial(): void {
        const scene = this.context.runtime.render?.scene;
        if (!scene) return;
        scene.overrideMaterial = this.transitionMaterial;
    }

    private endTransition(): void {
        const scene = this.context.runtime.render?.scene;
        if (scene && scene.overrideMaterial === this.transitionMaterial) {
            scene.overrideMaterial = null;
        }
        this.phase = 'idle';
        this.phaseTimeSec = 0;
        this.pendingSwitch = null;
        this.switchTriggered = false;
        this.transitionMaterial.uniforms.uWarp.value = 0.0;
    }

    private playTransitionSound(kind: 'appear' | 'disappear'): void {
        this.context.runtime.audio?.playFxSweep({
            down: kind === 'disappear',
            intensity: 0.95
        });
    }
}
