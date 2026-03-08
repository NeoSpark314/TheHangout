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
        intensity: 0.55,
        durationMs: 30,
        cooldownMs: 70,
        weakMagnitude: 0.45,
        strongMagnitude: 0.55
    };
    private readonly grabHintPreset: IHapticPreset = {
        intensity: 0.65,
        durationMs: 36,
        cooldownMs: 120,
        weakMagnitude: 0.55,
        strongMagnitude: 0.65
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

        let didPulse = false;
        const hapticActuators = (gamepad as any).hapticActuators as Array<{ pulse?: (v: number, ms: number) => Promise<boolean> | boolean }> | undefined;
        if (hapticActuators && hapticActuators.length > 0) {
            for (const actuator of hapticActuators) {
                if (!actuator?.pulse) continue;
                didPulse = true;
                try {
                    void actuator.pulse(preset.intensity, preset.durationMs);
                } catch {
                    // Ignore per-actuator failures and continue trying others.
                }
            }
        }

        const vibrationActuator = (gamepad as any).vibrationActuator as {
            playEffect?: (type: string, params: {
                startDelay: number;
                duration: number;
                weakMagnitude: number;
                strongMagnitude: number;
            }) => Promise<boolean> | boolean;
        } | undefined;
        if (!didPulse && vibrationActuator?.playEffect) {
            try {
                void vibrationActuator.playEffect('dual-rumble', {
                    startDelay: 0,
                    duration: preset.durationMs,
                    weakMagnitude: preset.weakMagnitude ?? preset.intensity,
                    strongMagnitude: preset.strongMagnitude ?? preset.intensity
                });
            } catch {
                // Ignore unsupported effect/type failures.
            }
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

        let fallback: Gamepad | null = null;
        for (const source of session.inputSources) {
            if (source.gamepad && !fallback) {
                fallback = source.gamepad;
            }
            if (source.handedness === hand && source.gamepad) {
                return source.gamepad;
            }
        }

        // Some runtimes may not expose stable handedness immediately.
        return fallback;
    }
}
