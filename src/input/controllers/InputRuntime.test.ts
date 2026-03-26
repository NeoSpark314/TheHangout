import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import eventBus from '../../app/events/EventBus';
import { EVENTS } from '../../shared/constants/Constants';
import { InputRuntime } from './InputRuntime';

const keyboardState = {
    down: new Set<string>(),
    pressed: new Set<string>()
};
const gamepadState = {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 },
    buttons: Array.from({ length: 8 }, () => false),
    isConnected: false,
    hadMeaningfulInputThisFrame: false,
    pressedButtons: new Set<number>()
};
const mobileState = {
    move: { x: 0, y: 0 },
    look: { x: 0, y: 0 }
};
const interactionState = {
    held: false
};
const xrState = {
    move: { x: 0, y: 0 },
    turn: 0,
    shortMenu: false,
    longMenu: false,
    handLocomotion: {
        left: false,
        right: false
    }
};

vi.mock('./KeyboardController', () => ({
    KeyboardController: class {
        public isKeyPressed(key: string) {
            return keyboardState.pressed.has(key);
        }
        public isKeyDown(key: string) {
            return keyboardState.down.has(key);
        }
        public clearJustPressed() {
            keyboardState.pressed.clear();
        }
    }
}));

vi.mock('./GamepadController', () => ({
    GamepadController: class {
        public move = gamepadState.move;
        public look = gamepadState.look;
        public buttons = gamepadState.buttons;
        public isConnected = gamepadState.isConnected;
        public hadMeaningfulInputThisFrame = false;
        public poll() {
            this.move = gamepadState.move;
            this.look = gamepadState.look;
            this.buttons = gamepadState.buttons;
            this.isConnected = gamepadState.isConnected;
            this.hadMeaningfulInputThisFrame = gamepadState.hadMeaningfulInputThisFrame;
        }
        public wasPressed(index: number) {
            return gamepadState.pressedButtons.has(index);
        }
    }
}));

vi.mock('./MobileJoystickController', () => ({
    MobileJoystickController: class {
        public init() {}
        public getMoveVector() {
            return mobileState.move;
        }
        public getLookVector() {
            return mobileState.look;
        }
    }
}));

vi.mock('./DesktopReachAssistController', () => ({
    NonVRReachAssistController: class {
        public update() {}
        public beginMobileAction() {}
        public endMobileAction() {}
        public getMobilePrimaryActionLabel() {
            return null;
        }
        public hasMobilePrimaryAction() {
            return false;
        }
        public isActive() {
            return false;
        }
    }
}));

vi.mock('./DesktopInteractionController', () => ({
    NonVRInteractionController: class {
        public update() {}
        public toggleMobileSecondaryAction() {}
        public hasMobileSecondaryAction() {
            return false;
        }
        public getMobileSecondaryActionLabel() {
            return null;
        }
        public isInteractionHeld() {
            return interactionState.held;
        }
    }
}));

vi.mock('./XRInputController', () => ({
    XRInputController: class {
        public move = xrState.move;
        public turn = xrState.turn;
        public poll() {
            this.move = xrState.move;
            this.turn = xrState.turn;
        }
        public wasMenuShortPressJustTriggered() {
            return xrState.shortMenu;
        }
        public wasMenuLongPressJustTriggered() {
            return xrState.longMenu;
        }
        public isHandLocomotionActive(hand: 'left' | 'right') {
            return xrState.handLocomotion[hand];
        }
    }
}));

vi.mock('./XRHapticsController', () => ({
    XRHapticsController: class {
        public pulseUiHover() {}
        public pulseGrabHint() {}
    }
}));

vi.mock('../../skills/GrabSkill', () => ({
    GrabSkill: class {
        constructor(private hand: 'left' | 'right' | null = null) {}
        public getSingleInteractableHoldingHand() {
            return this.hand;
        }
    }
}));

function resetInputStates(): void {
    keyboardState.down.clear();
    keyboardState.pressed.clear();
    gamepadState.move = { x: 0, y: 0 };
    gamepadState.look = { x: 0, y: 0 };
    gamepadState.buttons = Array.from({ length: 8 }, () => false);
    gamepadState.isConnected = false;
    gamepadState.hadMeaningfulInputThisFrame = false;
    gamepadState.pressedButtons.clear();
    mobileState.move = { x: 0, y: 0 };
    mobileState.look = { x: 0, y: 0 };
    interactionState.held = false;
    xrState.move = { x: 0, y: 0 };
    xrState.turn = 0;
    xrState.shortMenu = false;
    xrState.longMenu = false;
    xrState.handLocomotion.left = false;
    xrState.handLocomotion.right = false;
}

function createContext() {
    const context = new AppContext();
    context.setRuntime('render', {
        isXRPresenting: vi.fn(() => false),
        getXRSession: vi.fn(() => null)
    } as any);
    context.setRuntime('tracking', {
        getState: vi.fn(() => ({
            head: {
                pose: {
                    position: { x: 0, y: 1.7, z: 0 },
                    quaternion: { x: 0, y: 0, z: 0, w: 1 }
                },
                yaw: 0
            },
            hands: {
                left: {
                    active: false,
                    hasJoints: false,
                    pose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    pointerPose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    joints: []
                },
                right: {
                    active: false,
                    hasJoints: false,
                    pose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    pointerPose: {
                        position: { x: 0, y: 0, z: 0 },
                        quaternion: { x: 0, y: 0, z: 0, w: 1 }
                    },
                    joints: []
                }
            }
        }))
    } as any);
    context.setRuntime('flatUi', {
        handleControllerCursor: vi.fn()
    } as any);
    context.setRuntime('vrUi', {
        handleControllerCursor: vi.fn()
    } as any);
    return context;
}

describe('InputRuntime', () => {
    beforeEach(() => {
        eventBus.reset();
        resetInputStates();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('suppresses world move and look intents while the desktop menu is open', () => {
        const context = createContext();
        context.isMenuOpen = true;
        keyboardState.down.add('w');
        mobileState.look = { x: 1, y: 0.5 };
        const runtime = new InputRuntime(context);

        const movePayloads: any[] = [];
        const lookPayloads: any[] = [];
        eventBus.on(EVENTS.INTENT_MOVE, (payload) => movePayloads.push(payload));
        eventBus.on(EVENTS.INTENT_LOOK, (payload) => lookPayloads.push(payload));

        runtime.update(0.016);

        expect(movePayloads).toHaveLength(1);
        expect(movePayloads[0].direction).toEqual({ x: 0, y: 0 });
        expect(lookPayloads).toHaveLength(0);
    });

    it('emits XR menu intents while the menu is open in XR', () => {
        const context = createContext();
        context.isMenuOpen = true;
        (context.runtime.render.isXRPresenting as any).mockReturnValue(true);
        xrState.shortMenu = true;
        xrState.longMenu = true;
        const runtime = new InputRuntime(context);

        const toggles: number[] = [];
        const recenters: number[] = [];
        eventBus.on(EVENTS.INTENT_MENU_TOGGLE, () => toggles.push(1));
        eventBus.on(EVENTS.INTENT_MENU_OPEN_RECENTER, () => recenters.push(1));

        runtime.update(0.016);

        expect(toggles).toHaveLength(1);
        expect(recenters).toHaveLength(1);
    });

    it('uses a guard window before switching desktop input mode back', () => {
        const context = createContext();
        const runtime = new InputRuntime(context);
        const nowSpy = vi.spyOn(performance, 'now');

        nowSpy.mockReturnValueOnce(1000);
        (runtime as any).markDesktopInputActivity('controller');
        expect(runtime.getDesktopInputMode()).toBe('controller');

        nowSpy.mockReturnValueOnce(1100);
        (runtime as any).markDesktopInputActivity('keyboardMouse');
        expect(runtime.getDesktopInputMode()).toBe('controller');

        nowSpy.mockReturnValueOnce(1400);
        (runtime as any).markDesktopInputActivity('keyboardMouse');
        expect(runtime.getDesktopInputMode()).toBe('keyboardMouse');
    });

    it('emits snap-turn intents only on edges', () => {
        const context = createContext();
        const runtime = new InputRuntime(context);
        const turns: number[] = [];
        eventBus.on(EVENTS.INTENT_VR_SNAP_TURN, (payload) => turns.push(payload.angle));

        xrState.turn = 1;
        runtime.update(0.016);
        runtime.update(0.016);
        xrState.turn = 0;
        runtime.update(0.016);
        xrState.turn = -1;
        runtime.update(0.016);

        expect(turns).toHaveLength(2);
        expect(turns[0]).toBeCloseTo(-Math.PI / 4);
        expect(turns[1]).toBeCloseTo(Math.PI / 4);
    });

    it('emits interaction edge events in non-XR mode', () => {
        const context = createContext();
        const runtime = new InputRuntime(context);
        const started: string[] = [];
        const ended: string[] = [];
        eventBus.on(EVENTS.INTENT_INTERACT_START, (payload) => started.push(payload.hand));
        eventBus.on(EVENTS.INTENT_INTERACT_END, (payload) => ended.push(payload.hand));

        interactionState.held = true;
        runtime.processInteractions();
        interactionState.held = false;
        runtime.processInteractions();

        expect(started).toEqual(['right']);
        expect(ended).toEqual(['right']);
    });

    it('clears latched XR bubble interaction when it is no longer eligible', async () => {
        const context = createContext();
        const { GrabSkill } = await import('../../skills/GrabSkill');
        const createGrabSkill = (hand: 'left' | 'right') => {
            const skill = Object.create((GrabSkill as any).prototype);
            skill.getSingleInteractableHoldingHand = () => hand;
            return skill;
        };
        (context.runtime.render.isXRPresenting as any).mockReturnValue(true);
        context.localPlayer = {
            getSkill: vi.fn(() => createGrabSkill('right'))
        } as any;

        const runtime = new InputRuntime(context);
        runtime.toggleXRBubbleInteraction('right');
        expect(runtime.isXRBubbleInteractionLatched('right')).toBe(true);

        context.localPlayer = {
            getSkill: vi.fn(() => createGrabSkill('left'))
        } as any;

        runtime.update(0.016);

        expect(runtime.isXRBubbleInteractionLatched('right')).toBe(false);
    });
});
