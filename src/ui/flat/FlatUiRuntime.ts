import eventBus from '../../app/events/EventBus';
import { AppContext } from '../../app/AppContext';
import { EVENTS } from '../../shared/constants/Constants';
import { isMobile } from '../../shared/utils/DeviceUtils';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { ControllerPointer } from '../shared/ControllerPointer';

export class FlatUiRuntime implements IUpdatable {
    private overlay: HTMLElement;
    private mainPanel: HTMLElement | null;
    private nameInput: HTMLInputElement;
    private createBtn: HTMLButtonElement;
    private joinBtn: HTMLButtonElement;
    private sessionInput: HTMLInputElement;
    private copySessionBtn: HTMLButtonElement;
    private avatarBtn: HTMLButtonElement;
    private avatarDialog: HTMLElement;
    private closeAvatarBtn: HTMLButtonElement;
    private avatarColorInput: HTMLInputElement;
    private voiceBtn: HTMLButtonElement | null;
    private statusText: HTMLElement;
    private errorText: HTMLElement;
    private versionInfo: HTMLElement;
    private shaInfo: HTMLElement;
    private desktopControls: HTMLElement | null;
    private myScreensList: HTMLElement | null;
    private addScreenBtn: HTMLButtonElement | null;
    private mobileHud: HTMLElement | null;
    private mobileMenuBtn: HTMLButtonElement | null;
    private mobileActionBtn: HTMLButtonElement | null;
    private mobileInteractBtn: HTMLButtonElement | null;
    private mobileReticle: HTMLElement | null;
    private controllerCursor: ControllerPointer;
    private controllerCursorTarget: HTMLElement | null = null;
    private isMobile: boolean;
    private _joysticksInitialized: boolean = false;
    private _mobileHudEnabled: boolean = false;

    constructor(private context: AppContext) {
        this.overlay = document.getElementById('ui-overlay')!;
        this.mainPanel = document.getElementById('main-panel');
        this.nameInput = document.getElementById('player-name') as HTMLInputElement;
        this.createBtn = document.getElementById('create-btn') as HTMLButtonElement;
        this.joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
        this.sessionInput = document.getElementById('session-id') as HTMLInputElement;
        this.copySessionBtn = document.getElementById('copy-session-btn') as HTMLButtonElement;
        this.avatarBtn = document.getElementById('avatar-btn') as HTMLButtonElement;
        this.avatarDialog = document.getElementById('avatar-dialog')!;
        this.closeAvatarBtn = document.getElementById('close-avatar-btn') as HTMLButtonElement;
        this.avatarColorInput = document.getElementById('avatar-color') as HTMLInputElement;
        this.voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
        this.statusText = document.getElementById('status-text')!;
        this.errorText = document.getElementById('error-text')!;
        this.versionInfo = document.getElementById('app-version')!;
        this.shaInfo = document.getElementById('git-sha')!;
        this.desktopControls = document.getElementById('desktop-controls');
        this.myScreensList = document.getElementById('my-screens-list');
        this.addScreenBtn = document.getElementById('add-screen-btn') as HTMLButtonElement | null;
        this.mobileHud = document.getElementById('mobile-hud');
        this.mobileMenuBtn = document.getElementById('mobile-menu-btn') as HTMLButtonElement | null;
        this.mobileActionBtn = document.getElementById('mobile-action-btn') as HTMLButtonElement | null;
        this.mobileInteractBtn = document.getElementById('mobile-interact-btn') as HTMLButtonElement | null;
        this.mobileReticle = document.getElementById('mobile-reticle');
        this.controllerCursor = new ControllerPointer('controller-cursor');
        this.isMobile = isMobile;

        this.init();
        this.showOverlay(); // Ensure it's visible initially
    }

    private init(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionIdToJoin = urlParams.get('session');

        if (sessionIdToJoin) {
            this.setupGuestMode(sessionIdToJoin);
        } else {
            this.setupDefaultMode();
        }

        const networkBadge = document.getElementById('network-mode');
        if (networkBadge) {
            if (this.context.isLocalServer) {
                networkBadge.textContent = '🖥 Dedicated Server';
                networkBadge.classList.add('server');
            } else {
                networkBadge.textContent = '☁ PeerJS';
                networkBadge.classList.add('peerjs');
            }
        }

        if (this.copySessionBtn) {
            this.copySessionBtn.addEventListener('click', () => this.handleInlineCopy());
        }

        if (this.voiceBtn) {
            this.voiceBtn.addEventListener('click', async () => {
                this.ensureAudioContextResumed();
                await this.setVoicePreference(!this.context.voiceAutoEnable);
                this.saveToStorage();
            });
        }

        this.nameInput.addEventListener('input', () => {
            this.context.playerName = this.nameInput.value.trim();
            this.saveToStorage();
        });

        this.sessionInput.addEventListener('input', () => {
            this.saveToStorage();
        });

        if (this.avatarBtn) {
            this.avatarBtn.addEventListener('click', () => {
                this.showElement(this.avatarDialog);
            });
        }

        if (this.closeAvatarBtn) {
            this.closeAvatarBtn.addEventListener('click', () => {
                this.hideElement(this.avatarDialog);
            });
        }

        if (this.avatarColorInput) {
            this.avatarColorInput.addEventListener('input', () => {
                this.context.avatarConfig.color = this.avatarColorInput.value;
                this.saveToStorage();
                eventBus.emit(EVENTS.AVATAR_CONFIG_UPDATED, this.context.avatarConfig);
                this.updateAvatarButtonColor(this.context.avatarConfig.color as string);
            });
        }

        if (this.addScreenBtn) {
            this.addScreenBtn.addEventListener('click', () => {
                const screens = this.context.runtime.remoteDesktop.getConfigs();
                screens.push({ name: `Screen ${screens.length + 1}`, key: '' });
                this.context.runtime.remoteDesktop.setConfigs(screens);
                this.renderMyScreensEditor();
            });
        }

        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.addEventListener('click', () => {
                if (this._mobileHudEnabled) {
                    this.context.runtime.vrUi?.toggle2DMenu();
                }
            });
        }

        if (this.mobileActionBtn) {
            const beginAction = (e: Event) => {
                e.preventDefault();
                this.context.runtime.input?.beginMobilePrimaryAction();
            };
            const endAction = (e: Event) => {
                e.preventDefault();
                this.context.runtime.input?.endMobilePrimaryAction();
            };

            this.mobileActionBtn.addEventListener('pointerdown', beginAction);
            this.mobileActionBtn.addEventListener('pointerup', endAction);
            this.mobileActionBtn.addEventListener('pointercancel', endAction);
            this.mobileActionBtn.addEventListener('pointerleave', endAction);
        }

        if (this.mobileInteractBtn) {
            this.mobileInteractBtn.addEventListener('click', (e) => {
                e.preventDefault();
                this.context.runtime.input?.toggleMobileSecondaryAction();
            });
        }

        // Session UI events are handled in setupGuestMode / setupDefaultMode

        eventBus.on(EVENTS.HOST_READY, (peerId: string) => {
            if (this.context.isHost) {
                this.setStatus('Session Created! Starting...');
                this.ensureAudioContextResumed();
                setTimeout(() => this.hideOverlay(), 1000);
            }
        });

        eventBus.on(EVENTS.SESSION_CONNECTED, () => {
            if (!this.context.isHost) {
                this.setStatus('Connected!');
                setTimeout(() => this.hideOverlay(), 1000);
            }
        });

        eventBus.on(EVENTS.NETWORK_ERROR, (err: string) => {
            this.showError(err);
            this.enableAllButtons();
            this.setStatus('Ready');
        });

        eventBus.on(EVENTS.HOST_DISCONNECTED, () => {
            this.showError('Host disconnected. Session ended.');
            this.handleLeave();
        });

        eventBus.on(EVENTS.VOICE_STATE_UPDATED, () => {
            this.updateVoiceButton(this.context.voiceAutoEnable);
        });
        eventBus.on(EVENTS.DESKTOP_SCREENS_UPDATED, () => {
            this.renderMyScreensEditor();
        });

        this.loadFromStorage();
        this.renderMyScreensEditor();
        this.markPanelReady();

        // Desktop screen sharing is only for dedicated server mode
        if (!this.context.isLocalServer) {
            const screensGroup = document.getElementById('avatar-screens-group');
            if (screensGroup) this.hideElement(screensGroup);
        }
    }

    public update(delta: number): void {
        if (this.isElementHidden(this.overlay) && this.isMobile && !this._joysticksInitialized) {
            this.context.runtime.input?.initMobileJoysticks();
            this._joysticksInitialized = true;
        }

        if (this.isMobile) {
            this.updateMobileHudState();
        }
    }

    public handleControllerCursor(
        delta: number,
        stick: { x: number; y: number },
        confirmPressed: boolean,
        controllerConnected: boolean
    ): void {
        if (!controllerConnected || this.isElementHidden(this.overlay)) {
            this.controllerCursor.hide();
            this.updateControllerCursorTarget(null);
            return;
        }

        this.controllerCursor.show();
        const position = this.controllerCursor.move(delta, stick);
        if (!position) return;

        const target = this.resolveControllerCursorTarget(position.x, position.y);
        this.updateControllerCursorTarget(target);

        if (confirmPressed && target) {
            target.focus?.();
            target.click();
        }
    }

    private generateRandomName(): string {
        const adjectives = [
            'Neon', 'Cyber', 'Chrome', 'Laser', 'Retro', 'Synth', 'Pixel', 'Vector',
            'Static', 'Glitch', 'Binary', 'Digital', 'Atomic', 'Cosmic', 'Plasma', 'Electric'
        ];
        const nouns = [
            'Rider', 'Ghost', 'Glitch', 'Runner', 'Phantom', 'Wave', 'Pulse', 'Spark',
            'Cipher', 'Nomad', 'Drifter', 'Echo', 'Void', 'Horizon', 'Core', 'Link'
        ];

        const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        const num = Math.floor(Math.random() * 900) + 100;

        return `${adj}-${noun}-${num}`;
    }

    private loadFromStorage(): void {
        const storedName = localStorage.getItem('hangout_playerName');
        if (!storedName) {
            const randomName = this.generateRandomName();
            this.nameInput.value = randomName;
            localStorage.setItem('hangout_playerName', randomName);
        } else {
            this.nameInput.value = storedName;
        }

        const storedSession = localStorage.getItem('hangout_lastSessionId');
        if (!storedSession) {
            const defaultSession = 'DefaultMeetingSession';
            this.sessionInput.value = defaultSession;
            localStorage.setItem('hangout_lastSessionId', defaultSession);
        } else {
            this.sessionInput.value = storedSession;
        }

        const storedVoice = localStorage.getItem('hangout_voiceEnabled');
        if (storedVoice === 'false') {
            this.context.voiceAutoEnable = false;
        } else {
            this.context.voiceAutoEnable = true;
            if (storedVoice === null) {
                localStorage.setItem('hangout_voiceEnabled', 'true');
            }
        }
        this.context.voiceEnabled = this.context.runtime.media?.isMicrophoneEnabled() || false;
        this.updateVoiceButton(this.context.voiceAutoEnable);

        const storedColor = localStorage.getItem('hangout_avatarColor');
        if (storedColor) {
            this.context.avatarConfig.color = storedColor;
        } else {
            const randomColor = this.generateRandomAvatarColor();
            this.context.avatarConfig.color = randomColor;
            localStorage.setItem('hangout_avatarColor', randomColor);
        }

        if (this.avatarColorInput) this.avatarColorInput.value = this.context.avatarConfig.color as string;
        this.updateAvatarButtonColor(this.context.avatarConfig.color as string);

        this.context.playerName = this.nameInput.value.trim();

        const appVersion = __APP_VERSION__ || 'dev';
        const gitSha = __GIT_SHA__ || 'local';
        const buildTime = __BUILD_TIME__ || 'unknown';

        if (this.versionInfo) this.versionInfo.textContent = `v${appVersion}`;
        if (this.shaInfo) this.shaInfo.textContent = `build: ${gitSha} (${buildTime})`;
        this.context.runtime.remoteDesktop.loadConfigsFromStorage();
    }

    private saveToStorage(): void {
        const name = this.nameInput.value.trim();
        const session = this.sessionInput.value.trim();
        if (name) {
            localStorage.setItem('hangout_playerName', name);
            this.context.playerName = name;
            eventBus.emit(EVENTS.LOCAL_NAME_UPDATED, name);
        }
        if (this.context.avatarConfig.color) {
            localStorage.setItem('hangout_avatarColor', this.context.avatarConfig.color as string);
        }
        localStorage.setItem('hangout_voiceEnabled', String(this.context.voiceAutoEnable));
        if (session) {
            localStorage.setItem('hangout_lastSessionId', session);
        }
    }

    private generateReadableSessionId(): string {
        const adjs = ['neon', 'cyber', 'retro', 'pixel', 'synth', 'hyper', 'quantum', 'turbo', 'holo', 'astro'];
        const nouns = ['tiger', 'rider', 'runner', 'punk', 'wave', 'grid', 'nexus', 'core', 'blade', 'nova'];
        const adj = adjs[Math.floor(Math.random() * adjs.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj}-${noun}-${Math.floor(Math.random() * 100)}`;
    }

    private generateRandomAvatarColor(): string {
        const value = Math.floor(Math.random() * 0x1000000);
        return `#${value.toString(16).padStart(6, '0')}`;
    }

    private disableAllButtons(): void {
        this.createBtn.disabled = true;
        this.joinBtn.disabled = true;
    }

    private enableAllButtons(): void {
        this.createBtn.disabled = false;
        this.joinBtn.disabled = false;
    }

    private setupGuestMode(sessionId: string): void {
        this.context.isHost = false;
        if (this.createBtn) this.hideElement(this.createBtn);
        this.sessionInput.value = sessionId;
        this.joinBtn.addEventListener('click', async () => {
            this.ensureAudioContextResumed();
            this.context.playerName = this.nameInput.value.trim() || 'Guest';
            if (this.context.voiceAutoEnable) {
                await this.context.runtime.media.ensureMicrophoneEnabled();
            }
            this.setStatus('Connecting to host...');
            this.joinBtn.disabled = true;
            eventBus.emit(EVENTS.JOIN_SESSION, this.sessionInput.value.trim() || sessionId);
        });
    }

    private setupDefaultMode(): void {
        if (this.context.isLocalServer) {
            this.hideElement(this.createBtn);

            this.joinBtn.textContent = 'Enter Hangout';
            this.joinBtn.classList.add('primary-btn');

            this.joinBtn.addEventListener('click', async () => {
                this.ensureAudioContextResumed();
                this.context.playerName = this.nameInput.value.trim() || 'Player';
                if (this.context.voiceAutoEnable) {
                    await this.context.runtime.media.ensureMicrophoneEnabled();
                }
                const targetId = this.sessionInput.value.trim() || this.generateReadableSessionId();
                this.sessionInput.value = targetId; // populate if random generated
                this.disableAllButtons();
                this.clearError();
                this.saveToStorage();

                this.context.isHost = false;
                this.setStatus('Connecting to headless server...');
                eventBus.emit(EVENTS.JOIN_SESSION, targetId);
            });
            return;
        }

        this.createBtn.addEventListener('click', async () => {
            this.ensureAudioContextResumed();
            this.context.playerName = this.nameInput.value.trim() || 'Host';
            if (this.context.voiceAutoEnable) {
                await this.context.runtime.media.ensureMicrophoneEnabled();
            }
            const customId = this.sessionInput.value.trim() || this.generateReadableSessionId();
            this.disableAllButtons();
            this.clearError();
            this.saveToStorage();

            this.context.isHost = true;
            this.setStatus('Creating session...');
            eventBus.emit(EVENTS.CREATE_SESSION, customId);
        });

        this.joinBtn.addEventListener('click', async () => {
            this.ensureAudioContextResumed();
            this.context.playerName = this.nameInput.value.trim() || 'Player';
            if (this.context.voiceAutoEnable) {
                await this.context.runtime.media.ensureMicrophoneEnabled();
            }
            const targetId = this.sessionInput.value.trim();
            if (!targetId) {
                this.setStatus('Please enter a Session Name to join.');
                return;
            }
            this.disableAllButtons();
            this.clearError();
            this.saveToStorage();
            this.context.isHost = false;
            this.setStatus('Connecting to host...');
            eventBus.emit(EVENTS.JOIN_SESSION, targetId);
        });
    }

    private renderMyScreensEditor(): void {
        if (!this.myScreensList) return;
        this.myScreensList.innerHTML = '';

        const screens = this.context.runtime.remoteDesktop.getConfigs();
        for (let i = 0; i < screens.length; i++) {
            const row = screens[i];
            const rowEl = document.createElement('div');
            rowEl.className = 'screen-row';

            const nameInput = document.createElement('input');
            nameInput.type = 'text';
            nameInput.placeholder = 'Screen Name';
            nameInput.value = row.name;
            nameInput.className = 'screen-input';

            const keyInput = document.createElement('input');
            keyInput.type = 'text';
            keyInput.placeholder = 'Secret Key';
            keyInput.value = row.key;
            keyInput.className = 'screen-input';

            const removeBtn = document.createElement('button');
            removeBtn.className = 'primary-btn secondary-style screen-btn-compact';
            removeBtn.type = 'button';
            removeBtn.textContent = 'Remove';

            const updateRow = () => {
                const name = nameInput.value;
                const key = keyInput.value;

                nameInput.classList.toggle('input-invalid', name.length > 0 && name.length < 4);
                keyInput.classList.toggle('input-invalid', key.length > 0 && key.length < 4);

                if (name.length >= 4 && key.length >= 4) {
                    const next = this.context.runtime.remoteDesktop.getConfigs();
                    if (!next[i]) return;
                    next[i] = { name, key };
                    this.context.runtime.remoteDesktop.setConfigs(next, true);
                }
            };

            nameInput.addEventListener('input', updateRow);
            keyInput.addEventListener('input', updateRow);
            removeBtn.addEventListener('click', () => {
                const next = this.context.runtime.remoteDesktop.getConfigs();
                next.splice(i, 1);
                this.context.runtime.remoteDesktop.setConfigs(next);
                this.renderMyScreensEditor();
            });

            rowEl.appendChild(nameInput);
            rowEl.appendChild(keyInput);
            rowEl.appendChild(removeBtn);
            this.myScreensList.appendChild(rowEl);
        }
    }

    private handleInlineCopy(): void {
        const sessionId = this.sessionInput.value.trim() || 'DefaultMeetingSession';
        const url = new URL(window.location.href);
        url.searchParams.set('session', sessionId);
        const originalIcon = this.copySessionBtn.textContent;
        navigator.clipboard.writeText(url.toString()).then(() => {
            this.copySessionBtn.textContent = '✅';
            setTimeout(() => { this.copySessionBtn.textContent = originalIcon; }, 2000);
        }).catch(() => { this.setStatus('Copy Failed'); });
    }

    public setStatus(msg: string): void {
        if (this.statusText) {
            this.statusText.textContent = msg;
        }
    }

    public showError(msg: string): void {
        if (this.errorText) {
            this.errorText.textContent = msg;
        }
    }

    public clearError(): void {
        if (this.errorText) {
            this.errorText.textContent = "";
        }
    }

    public hideOverlay(): void {
        console.log('[FlatUiRuntime] hideOverlay() called');
        this.context.isMenuOpen = false;
        this.controllerCursor.hide();
        this.updateControllerCursorTarget(null);
        if (this.overlay) {
            this.overlay.style.opacity = '0';
            setTimeout(() => {
                this.hideElement(this.overlay);
                if (this.desktopControls && !this.isMobile) {
                    console.log('[FlatUiRuntime] Showing desktop controls');
                    this.showElement(this.desktopControls);
                }
                if (this.isMobile) {
                    this._mobileHudEnabled = true;
                    if (this.mobileHud) this.showElement(this.mobileHud);
                    if (this.mobileMenuBtn) this.showElement(this.mobileMenuBtn);
                    this.context.runtime.input?.initMobileJoysticks();
                    this._joysticksInitialized = true;
                    this.updateMobileHudState();
                }
            }, 500);
        }
    }

    private ensureAudioContextResumed(): void {
        if (this.context.runtime.render && this.context.runtime.render.audioListener) {
            if (this.context.runtime.render.audioListener.context.state === 'suspended') {
                this.context.runtime.render.audioListener.context.resume();
            }
        }
    }

    public getNavigableElements(): HTMLElement[] {
        if (!this.overlay || this.isElementHidden(this.overlay)) return [];
        const elements: HTMLElement[] = [];
        if (this.nameInput && this.nameInput.offsetParent) elements.push(this.nameInput);
        if (this.sessionInput && this.sessionInput.offsetParent) elements.push(this.sessionInput);
        if (this.copySessionBtn && this.copySessionBtn.offsetParent) elements.push(this.copySessionBtn);
        if (this.createBtn && this.createBtn.offsetParent) elements.push(this.createBtn);
        if (this.joinBtn && this.joinBtn.offsetParent) elements.push(this.joinBtn);
        if (this.voiceBtn && this.voiceBtn.offsetParent) elements.push(this.voiceBtn);
        return elements;
    }

    private async setVoicePreference(enabled: boolean): Promise<void> {
        this.context.voiceAutoEnable = enabled;
        const actualState = await this.context.runtime.media.setMicrophoneEnabled(enabled);
        if (!enabled) {
            this.context.voiceEnabled = false;
        } else {
            this.context.voiceEnabled = actualState;
        }
    }

    private updateVoiceButton(enabled: boolean): void {
        if (!this.voiceBtn) return;
        if (enabled) {
            this.voiceBtn.textContent = 'Auto Mic: On';
            this.voiceBtn.classList.add('ready');
        } else {
            this.voiceBtn.textContent = 'Auto Mic: Off';
            this.voiceBtn.classList.remove('ready');
        }
    }

    private updateAvatarButtonColor(color: string): void {
        if (!this.avatarBtn) return;
        this.avatarBtn.style.setProperty('--avatar-color', color);
        this.avatarBtn.style.backgroundColor = `${color}33`;
        this.avatarBtn.style.borderColor = color;
        this.avatarBtn.style.boxShadow = `0 0 15px ${color}66`;
    }

    public showOverlay(): void {
        console.log('[FlatUiRuntime] showOverlay() called');
        this.context.isMenuOpen = true;
        this.controllerCursor.reset();
        if (this.overlay) {
            this.showElement(this.overlay);
            this.overlay.offsetHeight;
            this.overlay.style.opacity = '1';
        }
        if (this.desktopControls) {
            console.log('[FlatUiRuntime] Hiding desktop controls');
            this.hideElement(this.desktopControls);
        }
        if (this.mobileHud) this.hideElement(this.mobileHud);
        if (this.mobileActionBtn) this.hideElement(this.mobileActionBtn);
        if (this.mobileInteractBtn) this.hideElement(this.mobileInteractBtn);
        if (this.mobileReticle) this.mobileReticle.classList.remove('active');
        if (this.mobileMenuBtn) {
            this.setElementVisible(this.mobileMenuBtn, this.isMobile && this._mobileHudEnabled);
        }
    }

    private handleLeave(): void {
        if (this.context.runtime.network) this.context.runtime.network.disconnect();
        if (this.context.runtime.media) this.context.runtime.media.stopMicrophone();
        if (this.context.runtime.entity) {
            const entities = Array.from(this.context.runtime.entity.entities.values());
            entities.forEach(entity => {
                if (entity.id !== this.context.localPlayer?.id) {
                    this.context.runtime.entity!.removeEntity(entity.id);
                }
            });
        }
        this.context.isDedicatedHost = false;
        this._mobileHudEnabled = false;
        if (this.mobileMenuBtn) this.hideElement(this.mobileMenuBtn);
        this.showOverlay();
        this.setStatus('Ready');
        this.enableAllButtons();
    }

    private updateMobileHudState(): void {
        if (!this.isMobile || !this._mobileHudEnabled) return;

        const input = this.context.runtime.input;
        const overlayHidden = this.isElementHidden(this.overlay);
        const showAction = overlayHidden && !!input?.hasMobilePrimaryAction();
        const showInteract = overlayHidden && !!input?.hasMobileSecondaryAction();

        if (this.mobileHud) {
            this.setElementVisible(this.mobileHud, overlayHidden);
        }

        if (this.mobileActionBtn) {
            if (showAction) {
                this.mobileActionBtn.textContent = input!.getMobilePrimaryActionLabel() || 'Use';
                this.showElement(this.mobileActionBtn);
            } else {
                this.hideElement(this.mobileActionBtn);
            }
        }

        if (this.mobileInteractBtn) {
            if (showInteract) {
                this.mobileInteractBtn.textContent = input!.getMobileSecondaryActionLabel() || 'Use';
                this.showElement(this.mobileInteractBtn);
            } else {
                this.hideElement(this.mobileInteractBtn);
            }
        }

        if (this.mobileReticle) {
            this.mobileReticle.classList.toggle('active', !!input?.isMobileFocusActive());
        }

        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.textContent = this.context.isMenuOpen ? 'Close' : 'Menu';
        }
    }

    public toggleOverlay(): void {
        if (this.context.isMenuOpen) {
            this.hideOverlay();
            return;
        }

        this.showOverlay();
    }

    private hideElement(element: HTMLElement): void {
        element.classList.add('is-hidden');
    }

    private showElement(element: HTMLElement): void {
        element.classList.remove('is-hidden');
    }

    private setElementVisible(element: HTMLElement, visible: boolean): void {
        if (visible) {
            this.showElement(element);
            return;
        }
        this.hideElement(element);
    }

    private isElementHidden(element: HTMLElement): boolean {
        return element.classList.contains('is-hidden');
    }

    private markPanelReady(): void {
        if (!this.mainPanel) return;
        this.mainPanel.classList.remove('panel-hydrating');
        this.mainPanel.classList.add('panel-ready');
    }

    private resolveControllerCursorTarget(x: number, y: number): HTMLElement | null {
        const hit = document.elementFromPoint(x, y);
        if (!(hit instanceof HTMLElement)) return null;

        const target = hit.closest('button, input, select, textarea, [role="button"], [tabindex]') as HTMLElement | null;
        if (!target || !this.overlay.contains(target) || target.hasAttribute('disabled')) {
            return null;
        }

        return target;
    }

    private updateControllerCursorTarget(nextTarget: HTMLElement | null): void {
        if (this.controllerCursorTarget === nextTarget) return;

        if (this.controllerCursorTarget) {
            this.controllerCursorTarget.classList.remove('gamepad-focus');
        }

        this.controllerCursorTarget = nextTarget;

        if (this.controllerCursorTarget) {
            this.controllerCursorTarget.classList.add('gamepad-focus');
        }
    }
}
