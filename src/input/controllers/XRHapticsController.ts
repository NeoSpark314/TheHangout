import { AppContext } from '../../app/AppContext';

type HandId = 'left' | 'right';

interface IHapticPreset {
    intensity: number;
    durationMs: number;
    cooldownMs: number;
    weakMagnitude?: number;
    strongMagnitude?: number;
}

/**
 * Centralized XR haptics adapter.
 * Gameplay/UI systems should call semantic methods instead of touching WebXR actuators directly.
 */
export class XRHapticsController {
    private readonly lastPulseAt = new Map<string, number>();
    private readonly uiHoverPreset: IHapticPreset = {
        intensity: 0.18,
        durationMs: 18,
        cooldownMs: 70,
        weakMagnitude: 0.14,
        strongMagnitude: 0.14
    };
    private readonly grabHintPreset: IHapticPreset = {
        intensity: 0.2,
        durationMs: 22,
        cooldownMs: 120,
        weakMagnitude: 0.16,
        strongMagnitude: 0.18
    };

    constructor(private context: AppContext) { }

    public pulseUiHover(hand: HandId): void {
        this.pulse(hand, 'ui-hover', this.uiHoverPreset);
    }

    public pulseGrabHint(hand: HandId): void {
        this.pulse(hand, 'grab-hint', this.grabHintPreset);
    }

    private pulse(hand: HandId, channel: string, preset: IHapticPreset): void {
        const key = `${channel}:${hand}`;
        const nowMs = performance.now();
        const lastAt = this.lastPulseAt.get(key) || 0;
        if ((nowMs - lastAt) < preset.cooldownMs) {
            return;
        }

        const gamepad = this.getHandGamepad(hand);
        if (!gamepad) {
            return;
        }

        this.lastPulseAt.set(key, nowMs);

        const hapticActuator = (gamepad as any).hapticActuators?.[0];
        if (hapticActuator?.pulse) {
            void hapticActuator.pulse(preset.intensity, preset.durationMs);
            return;
        }

        const vibrationActuator = (gamepad as any).vibrationActuator;
        if (vibrationActuator?.playEffect) {
            void vibrationActuator.playEffect('dual-rumble', {
                startDelay: 0,
                duration: preset.durationMs,
                weakMagnitude: preset.weakMagnitude ?? preset.intensity,
                strongMagnitude: preset.strongMagnitude ?? preset.intensity
            });
        }
    }

    private getHandGamepad(hand: HandId): Gamepad | null {
        const render = this.context.runtime.render;
        if (!render || !render.isXRPresenting()) {
            return null;
        }

        const session = render.getXRSession();
        if (!session) {
            return null;
        }

        for (const source of session.inputSources) {
            if (source.handedness === hand && source.gamepad) {
                return source.gamepad;
            }
        }

        return null;
    }
}

