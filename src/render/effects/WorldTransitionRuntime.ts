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
    float distanceBoost = mix(0.55, 1.0, clamp(distanceToHead / 8.0, 0.0, 1.0));
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

float valueNoise3D(vec3 p) {
    vec3 i = floor(p);
    vec3 f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);

    float n000 = hash13(i + vec3(0.0, 0.0, 0.0));
    float n100 = hash13(i + vec3(1.0, 0.0, 0.0));
    float n010 = hash13(i + vec3(0.0, 1.0, 0.0));
    float n110 = hash13(i + vec3(1.0, 1.0, 0.0));
    float n001 = hash13(i + vec3(0.0, 0.0, 1.0));
    float n101 = hash13(i + vec3(1.0, 0.0, 1.0));
    float n011 = hash13(i + vec3(0.0, 1.0, 1.0));
    float n111 = hash13(i + vec3(1.0, 1.0, 1.0));

    float nx00 = mix(n000, n100, u.x);
    float nx10 = mix(n010, n110, u.x);
    float nx01 = mix(n001, n101, u.x);
    float nx11 = mix(n011, n111, u.x);
    float nxy0 = mix(nx00, nx10, u.y);
    float nxy1 = mix(nx01, nx11, u.y);
    return mix(nxy0, nxy1, u.z);
}

float fbm3(vec3 p) {
    float sum = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
        sum += valueNoise3D(p * freq) * amp;
        freq *= 2.0;
        amp *= 0.5;
    }
    return sum / 0.96875; // normalize by total amplitude (0.5+0.25+0.125+0.0625+0.03125)
}

void main() {
    vec3 noisePos = vSourceWorldPos * 0.11 + vec3(uTime * 0.07);
    float noise = fbm3(noisePos);
    float distanceToHead = length(vSourceWorldPos - uHeadWorld);
    float normalizedDistance = clamp(distanceToHead / uRevealRadiusMax, 0.0, 1.0);
    float surfaceNoise = (noise - 0.5) * 2.0;
    // Blend radial reveal with smooth 3D noise so surfaces do not appear as a strict sphere.
    float revealMetric = normalizedDistance + surfaceNoise * 0.34;
    if (revealMetric < vWarp) discard;

    float pulse = 0.5 + 0.5 * sin(uTime * 3.4 + length(vWorldPos) * 0.22);
    float shimmer = mix(0.9, 1.08, noise) * mix(0.94, 1.06, pulse);
    vec3 base = vec3(0.08, 0.90, 0.95);
    vec3 accent = vec3(0.95, 0.98, 1.0);
    vec3 color = mix(base, accent, clamp(vWarp * 0.72 + noise * 0.18, 0.0, 1.0)) * shimmer;
    float edgeBand = 1.0 - smoothstep(0.0, 0.08, abs(revealMetric - vWarp));
    color += vec3(0.25, 0.55, 0.70) * edgeBand;

    float alpha = clamp(1.0 - smoothstep(0.82, 1.0, vWarp), 0.0, 1.0);
    if (alpha <= 0.001) discard;
    gl_FragColor = vec4(color, alpha);
}
`;

export class WorldTransitionRuntime implements IUpdatable {
    private readonly transitionDurationSec = 1.0;
    private readonly switchHiddenDelaySec = 0.06;
    private readonly infinityDistance = 130.0;
    private readonly revealRadiusMax = 34.0;
    private phase: TransitionPhase = 'idle';
    private phaseTimeSec = 0;
    private totalTimeSec = 0;
    private pendingSwitch: (() => void) | null = null;
    private switchTriggered = false;
    private hudVisibleBeforeTransition: boolean | null = null;
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
        const hudGroup = this.context.runtime.hud?.group;
        if (hudGroup) {
            this.hudVisibleBeforeTransition = hudGroup.visible;
            hudGroup.visible = false;
        }
        if (typeof document !== 'undefined') {
            document.body.classList.add('world-transition-active');
        }
    }

    private endTransition(): void {
        const scene = this.context.runtime.render?.scene;
        if (scene && scene.overrideMaterial === this.transitionMaterial) {
            scene.overrideMaterial = null;
        }
        const hudGroup = this.context.runtime.hud?.group;
        if (hudGroup && this.hudVisibleBeforeTransition !== null) {
            hudGroup.visible = this.hudVisibleBeforeTransition;
        }
        this.hudVisibleBeforeTransition = null;
        if (typeof document !== 'undefined') {
            document.body.classList.remove('world-transition-active');
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
            intensity: kind === 'disappear' ? 1.0 : 0.85
        });
    }
}
