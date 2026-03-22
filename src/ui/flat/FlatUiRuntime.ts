import eventBus from '../../app/events/EventBus';
import { AppContext } from '../../app/AppContext';
import { EVENTS } from '../../shared/constants/Constants';
import { isMobile } from '../../shared/utils/DeviceUtils';
import { IUpdatable } from '../../shared/contracts/IUpdatable';
import { ControllerPointer } from '../shared/ControllerPointer';
import { AppLocalStorage } from '../../shared/storage/AppLocalStorage';
import { ConfigRegistry, IConfigSchema } from '../../shared/config/ConfigRegistry';
import { validateVrmUrl } from '../../shared/avatar/AvatarUrlUtils';
import { clampPlayerHeightM, normalizeAvatarConfig } from '../../shared/contracts/IAvatar';

export class FlatUiRuntime implements IUpdatable {
    private static readonly KEYBOARD_MOUSE_HELP_HTML = [
        '<b>Controls</b>',
        'Menu: M',
        'Move: WASD',
        'Mouse Look: Right Click',
        'Hand Grab: Left Click + Hold',
        'Interact with Object: Right Click'
    ].join('<br>');
    private static readonly CONTROLLER_HELP_HTML = [
        '<b>Controls</b>',
        'Menu: Y / Triangle',
        'Move: Left Stick',
        'Look: Right Stick',
        'Left Hand Extend/Grab: LT',
        'Right Hand Extend/Grab: RT',
        'Hand Interact: A / Cross'
    ].join('<br>');
    private overlay: HTMLElement;
    private mainPanel: HTMLElement | null;
    private nameInput: HTMLInputElement;
    private createBtn: HTMLButtonElement;
    private joinBtn: HTMLButtonElement;
    private sessionIdInput: HTMLInputElement;
    private copyInviteLinkBtn: HTMLButtonElement;
    private avatarBtn: HTMLButtonElement;
    private avatarDialog: HTMLElement;
    private closeAvatarBtn: HTMLButtonElement;
    private avatarColorInput: HTMLInputElement;
    private avatarVrmUrlInput: HTMLInputElement | null;
    private avatarHeightInput: HTMLInputElement | null;
    private clearAvatarVrmBtn: HTMLButtonElement | null;
    private avatarVrmStatus: HTMLElement | null;
    private extensionsBtn: HTMLButtonElement | null;
    private extensionsDialog: HTMLElement | null;
    private closeExtensionsBtn: HTMLButtonElement | null;
    private extensionsContainer: HTMLElement | null;
    private voiceBtn: HTMLButtonElement | null;
    private statusText: HTMLElement;
    private errorText: HTMLElement;
    private versionInfo: HTMLElement;
    private shaInfo: HTMLElement;
    private desktopControls: HTMLElement | null;
    private mobileHud: HTMLElement | null;
    private mobileMenuBtn: HTMLButtonElement | null;
    private mobilePrimaryActionBtn: HTMLButtonElement | null;
    private mobileSecondaryActionBtn: HTMLButtonElement | null;
    private mobileReticle: HTMLElement | null;
    private controllerCursor: ControllerPointer;
    private controllerCursorTarget: HTMLElement | null = null;
    private isMobile: boolean;
    private joysticksInitialized: boolean = false;
    private mobileHudEnabled: boolean = false;
    private inviteSessionId: string | null = null;
    private hostScenarioOverrideId: string | null = null;
    private desktopHelpMode: 'keyboardMouse' | 'controller' | null = null;

    constructor(private context: AppContext) {
        this.overlay = document.getElementById('ui-overlay')!;
        this.mainPanel = document.getElementById('main-panel');
        this.nameInput = document.getElementById('player-name') as HTMLInputElement;
        this.createBtn = document.getElementById('create-btn') as HTMLButtonElement;
        this.joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
        this.sessionIdInput = document.getElementById('session-id') as HTMLInputElement;
        this.copyInviteLinkBtn = document.getElementById('copy-session-btn') as HTMLButtonElement;
        this.avatarBtn = document.getElementById('avatar-btn') as HTMLButtonElement;
        this.avatarDialog = document.getElementById('avatar-dialog')!;
        this.closeAvatarBtn = document.getElementById('close-avatar-btn') as HTMLButtonElement;
        this.avatarColorInput = document.getElementById('avatar-color') as HTMLInputElement;
        this.avatarVrmUrlInput = document.getElementById('avatar-vrm-url') as HTMLInputElement | null;
        this.avatarHeightInput = document.getElementById('avatar-height-m') as HTMLInputElement | null;
        this.clearAvatarVrmBtn = document.getElementById('clear-avatar-vrm-btn') as HTMLButtonElement | null;
        this.avatarVrmStatus = document.getElementById('avatar-vrm-status');

        this.extensionsBtn = document.getElementById('extensions-btn') as HTMLButtonElement | null;
        this.extensionsDialog = document.getElementById('extensions-dialog');
        this.closeExtensionsBtn = document.getElementById('close-extensions-btn') as HTMLButtonElement | null;
        this.extensionsContainer = document.getElementById('extensions-container');

        this.voiceBtn = document.getElementById('voice-btn') as HTMLButtonElement;
        this.statusText = document.getElementById('status-text')!;
        this.errorText = document.getElementById('error-text')!;
        this.versionInfo = document.getElementById('app-version')!;
        this.shaInfo = document.getElementById('git-sha')!;
        this.desktopControls = document.getElementById('desktop-controls');
        this.mobileHud = document.getElementById('mobile-hud');
        this.mobileMenuBtn = document.getElementById('mobile-menu-btn') as HTMLButtonElement | null;
        this.mobilePrimaryActionBtn = document.getElementById('mobile-action-btn') as HTMLButtonElement | null;
        this.mobileSecondaryActionBtn = document.getElementById('mobile-interact-btn') as HTMLButtonElement | null;
        this.mobileReticle = document.getElementById('mobile-reticle');
        this.controllerCursor = new ControllerPointer('controller-cursor');
        this.isMobile = isMobile;

        this.init();
        this.showOverlay(); // Ensure it's visible initially
    }

    private init(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const sessionIdToJoin = urlParams.get('session')?.trim() || null;
        this.inviteSessionId = sessionIdToJoin;
        this.hostScenarioOverrideId = urlParams.get('scenario')?.trim() || null;

        // Invite links only prefill the session id; joining/hosting keeps the same UI flow.
        this.setupDefaultMode();

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

        if (this.copyInviteLinkBtn) {
            this.copyInviteLinkBtn.addEventListener('click', () => this.handleInlineCopy());
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

        this.sessionIdInput.addEventListener('input', () => {
            this.saveToStorage();
        });

        if (this.avatarBtn) {
            this.avatarBtn.addEventListener('click', () => {
                this.refreshAvatarDialog();
                this.showElement(this.avatarDialog);
            });
        }

        if (this.closeAvatarBtn) {
            this.closeAvatarBtn.addEventListener('click', () => {
                this.refreshAvatarDialog();
                this.hideElement(this.avatarDialog);
            });
        }

        if (this.extensionsBtn && this.extensionsDialog) {
            this.extensionsBtn.addEventListener('click', () => {
                this.renderExtensionSettings();
                this.showElement(this.extensionsDialog!);
            });
        }

        if (this.closeExtensionsBtn && this.extensionsDialog) {
            this.closeExtensionsBtn.addEventListener('click', () => {
                this.hideElement(this.extensionsDialog!);
            });
        }

        if (this.avatarColorInput) {
            this.avatarColorInput.addEventListener('input', () => {
                this.context.avatarConfig.color = this.avatarColorInput.value;
                this.saveToStorage();
                eventBus.emit(EVENTS.AVATAR_CONFIG_UPDATED, this.context.avatarConfig);
                this.updateAvatarButtonColor(this.context.avatarConfig.color as string);
                this.updateAvatarUrlStatus();
            });
        }

        if (this.avatarVrmUrlInput) {
            this.avatarVrmUrlInput.addEventListener('input', () => {
                this.applyAvatarUrlInput();
            });
        }

        if (this.avatarHeightInput) {
            this.avatarHeightInput.addEventListener('input', () => {
                const nextHeight = clampPlayerHeightM(Number(this.avatarHeightInput!.value));
                this.context.avatarConfig = normalizeAvatarConfig({
                    ...this.context.avatarConfig,
                    playerHeightM: nextHeight
                });
                this.saveToStorage();
                eventBus.emit(EVENTS.AVATAR_CONFIG_UPDATED, this.context.avatarConfig);
            });
        }

        if (this.clearAvatarVrmBtn) {
            this.clearAvatarVrmBtn.addEventListener('click', () => {
                if (this.avatarVrmUrlInput) {
                    this.avatarVrmUrlInput.value = '';
                }
                this.context.avatarConfig = normalizeAvatarConfig({
                    ...this.context.avatarConfig,
                    renderMode: 'stick',
                    vrmUrl: null
                });
                this.saveToStorage();
                eventBus.emit(EVENTS.AVATAR_CONFIG_UPDATED, this.context.avatarConfig);
                this.updateAvatarUrlStatus();
            });
        }

        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.addEventListener('click', () => {
                if (this.mobileHudEnabled) {
                    this.context.runtime.vrUi?.toggle2DMenu();
                }
            });
        }

        if (this.mobilePrimaryActionBtn) {
            const beginAction = (e: Event) => {
                e.preventDefault();
                this.context.runtime.input?.beginMobilePrimaryAction();
            };
            const endAction = (e: Event) => {
                e.preventDefault();
                this.context.runtime.input?.endMobilePrimaryAction();
            };

            this.mobilePrimaryActionBtn.addEventListener('pointerdown', beginAction);
            this.mobilePrimaryActionBtn.addEventListener('pointerup', endAction);
            this.mobilePrimaryActionBtn.addEventListener('pointercancel', endAction);
            this.mobilePrimaryActionBtn.addEventListener('pointerleave', endAction);
        }

        if (this.mobileSecondaryActionBtn) {
            this.mobileSecondaryActionBtn.addEventListener('click', (e) => {
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
            if (this.extensionsDialog && !this.isElementHidden(this.extensionsDialog)) {
                this.renderExtensionSettings();
            }
        });

        this.loadFromStorage();
        this.updateDesktopControlsHint();
        this.markPanelReady();

        // Desktop screen sharing is only for dedicated server mode
        // Settings dialog owns screen management UI.
    }

    public update(delta: number): void {
        this.updateDesktopControlsHint();

        if (this.isElementHidden(this.overlay) && this.isMobile && !this.joysticksInitialized) {
            this.context.runtime.input?.initMobileJoysticks();
            this.joysticksInitialized = true;
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
        const storedName = AppLocalStorage.getPlayerName();
        if (!storedName) {
            const randomName = this.generateRandomName();
            this.nameInput.value = randomName;
            AppLocalStorage.setPlayerName(randomName);
        } else {
            this.nameInput.value = storedName;
        }

        const storedSession = AppLocalStorage.getLastSessionId();
        if (!storedSession) {
            const defaultSession = this.generateReadableSessionId();
            this.sessionIdInput.value = defaultSession;
            AppLocalStorage.setLastSessionId(defaultSession);
        } else {
            this.sessionIdInput.value = storedSession;
        }
        // Invite links should win over previous local defaults/history.
        if (this.inviteSessionId) {
            this.sessionIdInput.value = this.inviteSessionId;
            AppLocalStorage.setLastSessionId(this.inviteSessionId);
        }

        const storedVoice = AppLocalStorage.getVoiceAutoEnable();
        if (storedVoice === false) {
            this.context.voiceAutoEnable = false;
        } else {
            this.context.voiceAutoEnable = true;
            if (storedVoice === undefined) {
                AppLocalStorage.setVoiceAutoEnable(true);
            }
        }
        this.context.voiceEnabled = this.context.runtime.media?.isMicrophoneEnabled() || false;
        this.updateVoiceButton(this.context.voiceAutoEnable);
        this.context.renderLocalAvatar = AppLocalStorage.getRenderLocalAvatar() ?? true;

        const storedColor = AppLocalStorage.getAvatarColor();
        let avatarColor = storedColor;
        if (!avatarColor) {
            const randomColor = this.generateRandomAvatarColor();
            avatarColor = randomColor;
            AppLocalStorage.setAvatarColor(randomColor);
        }
        const storedRenderMode = AppLocalStorage.getAvatarRenderMode();
        const storedVrmUrl = AppLocalStorage.getAvatarVrmUrl();
        const storedPlayerHeightM = AppLocalStorage.getAvatarPlayerHeightM();
        this.context.avatarConfig = normalizeAvatarConfig({
            color: avatarColor,
            renderMode: storedRenderMode,
            vrmUrl: storedVrmUrl,
            playerHeightM: storedPlayerHeightM
        });

        if (this.avatarColorInput) this.avatarColorInput.value = this.context.avatarConfig.color as string;
        if (this.avatarVrmUrlInput) this.avatarVrmUrlInput.value = this.context.avatarConfig.vrmUrl || '';
        if (this.avatarHeightInput) this.avatarHeightInput.value = this.context.avatarConfig.playerHeightM.toFixed(2);
        this.updateAvatarButtonColor(this.context.avatarConfig.color as string);
        this.updateAvatarUrlStatus();

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
        const session = this.sessionIdInput.value.trim();
        if (name) {
            AppLocalStorage.setPlayerName(name);
            this.context.playerName = name;
            eventBus.emit(EVENTS.LOCAL_NAME_UPDATED, name);
        }
        if (this.context.avatarConfig.color) {
            AppLocalStorage.setAvatarColor(this.context.avatarConfig.color as string);
        }
        AppLocalStorage.setAvatarRenderMode(this.context.avatarConfig.renderMode);
        AppLocalStorage.setAvatarVrmUrl(this.context.avatarConfig.vrmUrl || null);
        AppLocalStorage.setAvatarPlayerHeightM(this.context.avatarConfig.playerHeightM);
        AppLocalStorage.setVoiceAutoEnable(this.context.voiceAutoEnable);
        AppLocalStorage.setRenderLocalAvatar(this.context.renderLocalAvatar);
        if (session) {
            AppLocalStorage.setLastSessionId(session);
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
                const targetId = this.sessionIdInput.value.trim() || this.generateReadableSessionId();
                this.sessionIdInput.value = targetId; // populate if random generated
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
            const customId = this.sessionIdInput.value.trim() || this.generateReadableSessionId();
            this.sessionIdInput.value = customId;
            this.disableAllButtons();
            this.clearError();
            this.saveToStorage();

            this.applyHostScenarioOverride();
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
            const targetId = this.sessionIdInput.value.trim();
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

    private renderScreensEditor(listHost: HTMLElement): void {
        listHost.innerHTML = '';
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
                this.renderScreensEditor(listHost);
            });

            rowEl.appendChild(nameInput);
            rowEl.appendChild(keyInput);
            rowEl.appendChild(removeBtn);
            listHost.appendChild(rowEl);
        }
    }

    private renderExtensionSettings(): void {
        if (!this.extensionsContainer) return;
        this.extensionsContainer.innerHTML = '';

        if (this.context.isLocalServer) {
            const screensGroup = document.createElement('div');
            screensGroup.className = 'input-group';

            const header = document.createElement('h3');
            header.textContent = 'My Screens';
            header.style.marginBottom = '5px';
            screensGroup.appendChild(header);

            const desc = document.createElement('p');
            desc.textContent = 'Configure screen name and secret key pairs for remote desktop sharing.';
            desc.style.fontSize = '0.9em';
            desc.style.color = '#ccc';
            desc.style.marginBottom = '10px';
            screensGroup.appendChild(desc);

            const listContainer = document.createElement('div');
            listContainer.className = 'screens-list';
            this.renderScreensEditor(listContainer);
            screensGroup.appendChild(listContainer);

            const addScreenBtn = document.createElement('button');
            addScreenBtn.className = 'primary-btn secondary-style';
            addScreenBtn.type = 'button';
            addScreenBtn.textContent = 'Add Screen';
            addScreenBtn.style.marginTop = '10px';
            addScreenBtn.addEventListener('click', () => {
                const screens = this.context.runtime.remoteDesktop.getConfigs();
                screens.push({ name: `Screen ${screens.length + 1}`, key: '' });
                this.context.runtime.remoteDesktop.setConfigs(screens);
                this.renderScreensEditor(listContainer);
            });
            screensGroup.appendChild(addScreenBtn);

            this.extensionsContainer.appendChild(screensGroup);
            const screensHr = document.createElement('hr');
            screensHr.style.borderColor = '#444';
            screensHr.style.margin = '20px 0';
            this.extensionsContainer.appendChild(screensHr);
        }

        const schemas = ConfigRegistry.getSchemas();
        if (schemas.length === 0) {
            if (!this.context.isLocalServer) {
                this.extensionsContainer.innerHTML = '<p class="status">No extensions registered.</p>';
            }
            return;
        }

        for (const schema of schemas) {
            const groupEl = document.createElement('div');
            groupEl.className = 'input-group';

            const header = document.createElement('h3');
            header.textContent = schema.title;
            header.style.marginBottom = '5px';
            groupEl.appendChild(header);

            if (schema.description) {
                const desc = document.createElement('p');
                desc.textContent = schema.description;
                desc.style.fontSize = '0.9em';
                desc.style.color = '#ccc';
                desc.style.marginBottom = '10px';
                groupEl.appendChild(desc);
            }

            if (schema.type === 'key-value-list') {
                const listContainer = document.createElement('div');
                listContainer.className = 'screens-list';

                const renderList = () => {
                    listContainer.innerHTML = '';
                    const items = ConfigRegistry.getKeyValueList(schema.id) || [];

                    for (let i = 0; i < items.length; i++) {
                        const item = items[i];
                        const rowEl = document.createElement('div');
                        rowEl.className = 'screen-row';

                        const nameInput = document.createElement('input');
                        nameInput.type = 'text';
                        nameInput.placeholder = 'Name';
                        nameInput.value = item.name;
                        nameInput.className = 'screen-input';

                        const targetInput = document.createElement('input');
                        targetInput.type = 'text';
                        targetInput.placeholder = 'URL';
                        targetInput.value = item.value;
                        targetInput.className = 'screen-input';

                        const removeBtn = document.createElement('button');
                        removeBtn.className = 'primary-btn secondary-style screen-btn-compact';
                        removeBtn.type = 'button';
                        removeBtn.textContent = 'Remove';

                        const updateRow = () => {
                            const newItems = [...ConfigRegistry.getKeyValueList(schema.id) || []];
                            if (newItems[i]) {
                                newItems[i] = { name: nameInput.value, value: targetInput.value };
                                ConfigRegistry.setKeyValueList(schema.id, newItems);
                            }
                        };

                        nameInput.addEventListener('input', updateRow);
                        targetInput.addEventListener('input', updateRow);
                        removeBtn.addEventListener('click', () => {
                            const newItems = [...ConfigRegistry.getKeyValueList(schema.id) || []];
                            newItems.splice(i, 1);
                            ConfigRegistry.setKeyValueList(schema.id, newItems);
                            renderList();
                        });

                        rowEl.appendChild(nameInput);
                        rowEl.appendChild(targetInput);
                        rowEl.appendChild(removeBtn);
                        listContainer.appendChild(rowEl);
                    }
                };

                renderList();
                groupEl.appendChild(listContainer);

                const addBtn = document.createElement('button');
                addBtn.className = 'primary-btn secondary-style';
                addBtn.type = 'button';
                addBtn.textContent = 'Add Item';
                addBtn.style.marginTop = '10px';
                addBtn.addEventListener('click', async () => {
                    const clipboardUrl = await this.tryReadClipboardUrl();
                    const items = ConfigRegistry.getKeyValueList(schema.id) || [];
                    const fallbackValue = schema.defaultTarget || '';
                    const value = clipboardUrl || fallbackValue;
                    const defaultName = this.getDefaultItemName(value, items.length + 1);
                    items.push({ name: defaultName, value });
                    ConfigRegistry.setKeyValueList(schema.id, items);
                    renderList();
                });
                groupEl.appendChild(addBtn);
            }

            this.extensionsContainer.appendChild(groupEl);

            // Add a separator between schemas
            const hr = document.createElement('hr');
            hr.style.borderColor = '#444';
            hr.style.margin = '20px 0';
            this.extensionsContainer.appendChild(hr);
        }
    }

    private applyHostScenarioOverride(): void {
        const scenarioId = this.hostScenarioOverrideId;
        if (!scenarioId) return;

        const availableScenarioIds = this.context.runtime.session?.getAvailableScenarioIds?.() ?? [];
        if (!availableScenarioIds.includes(scenarioId)) {
            console.warn('[FlatUiRuntime] Ignoring unknown host scenario override: ' + scenarioId);
            return;
        }

        this.context.sessionConfig = {
            ...this.context.sessionConfig,
            activeScenarioId: scenarioId
        };
    }
    private handleInlineCopy(): void {
        const sessionId = this.sessionIdInput.value.trim() || this.generateReadableSessionId();
        this.sessionIdInput.value = sessionId;
        this.saveToStorage();
        const url = new URL(window.location.href);
        url.searchParams.set('session', sessionId);
        const originalIcon = this.copyInviteLinkBtn.textContent;
        navigator.clipboard.writeText(url.toString()).then(() => {
            this.copyInviteLinkBtn.textContent = '✅';
            setTimeout(() => { this.copyInviteLinkBtn.textContent = originalIcon; }, 2000);
        }).catch(() => { this.setStatus('Copy Failed'); });
    }

    private async tryReadClipboardUrl(): Promise<string | null> {
        if (!navigator.clipboard?.readText) return null;
        try {
            const raw = (await navigator.clipboard.readText()).trim();
            if (!raw) return null;
            const parsed = new URL(raw);
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
            return parsed.toString();
        } catch {
            return null;
        }
    }

    private getDefaultItemName(urlText: string, itemIndex: number): string {
        if (!urlText) {
            return `Item ${itemIndex}`;
        }

        try {
            const parsed = new URL(urlText);
            const rawName = parsed.pathname.split('/').filter(Boolean).pop() || '';
            if (!rawName) {
                return parsed.hostname || `Item ${itemIndex}`;
            }

            const decoded = decodeURIComponent(rawName);
            const withoutQuery = decoded.split('?')[0].split('#')[0];
            const dotIndex = withoutQuery.lastIndexOf('.');
            const stem = dotIndex > 0 ? withoutQuery.slice(0, dotIndex) : withoutQuery;
            const normalized = stem.replace(/[_\-]+/g, ' ').trim();
            return normalized.length > 0 ? normalized : `Item ${itemIndex}`;
        } catch {
            return `Item ${itemIndex}`;
        }
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
                    this.mobileHudEnabled = true;
                    if (this.mobileHud) this.showElement(this.mobileHud);
                    if (this.mobileMenuBtn) this.showElement(this.mobileMenuBtn);
                    this.context.runtime.input?.initMobileJoysticks();
                    this.joysticksInitialized = true;
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
        if (this.sessionIdInput && this.sessionIdInput.offsetParent) elements.push(this.sessionIdInput);
        if (this.copyInviteLinkBtn && this.copyInviteLinkBtn.offsetParent) elements.push(this.copyInviteLinkBtn);
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

    private refreshAvatarDialog(): void {
        if (this.avatarColorInput) {
            this.avatarColorInput.value = this.context.avatarConfig.color as string;
        }
        if (this.avatarVrmUrlInput) {
            this.avatarVrmUrlInput.value = this.context.avatarConfig.vrmUrl || '';
        }
        if (this.avatarHeightInput) {
            this.avatarHeightInput.value = this.context.avatarConfig.playerHeightM.toFixed(2);
        }
        this.updateAvatarUrlStatus();
    }

    private applyAvatarUrlInput(): void {
        if (!this.avatarVrmUrlInput) return;

        const rawValue = this.avatarVrmUrlInput.value.trim();
        const validation = validateVrmUrl(rawValue, window.location.href, window.location.origin);
        if (!validation.valid) {
            this.updateAvatarUrlStatus(validation.error);
            return;
        }

        this.context.avatarConfig = normalizeAvatarConfig({
            ...this.context.avatarConfig,
            renderMode: rawValue ? 'vrm-auto' : 'stick',
            vrmUrl: rawValue || null
        });
        this.saveToStorage();
        eventBus.emit(EVENTS.AVATAR_CONFIG_UPDATED, this.context.avatarConfig);
        this.updateAvatarUrlStatus();
    }

    private updateAvatarUrlStatus(overrideError?: string | null): void {
        if (!this.avatarVrmStatus) return;

        const rawValue = this.avatarVrmUrlInput?.value.trim() || '';
        if (overrideError) {
            this.avatarVrmStatus.textContent = overrideError;
            return;
        }

        if (!rawValue) {
            this.avatarVrmStatus.textContent = 'Stick figure fallback is active.';
            return;
        }

        const validation = validateVrmUrl(rawValue, window.location.href, window.location.origin);
        this.avatarVrmStatus.textContent = validation.valid
            ? 'VRM will be used when supported. Stick figure stays as fallback.'
            : (validation.error || 'Avatar URL is invalid.');
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
        if (this.mobilePrimaryActionBtn) this.hideElement(this.mobilePrimaryActionBtn);
        if (this.mobileSecondaryActionBtn) this.hideElement(this.mobileSecondaryActionBtn);
        if (this.mobileReticle) this.mobileReticle.classList.remove('active');
        if (this.mobileMenuBtn) {
            this.setElementVisible(this.mobileMenuBtn, this.isMobile && this.mobileHudEnabled);
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
        this.mobileHudEnabled = false;
        if (this.mobileMenuBtn) this.hideElement(this.mobileMenuBtn);
        this.showOverlay();
        this.setStatus('Ready');
        this.enableAllButtons();
    }

    private updateMobileHudState(): void {
        if (!this.isMobile || !this.mobileHudEnabled) return;

        const input = this.context.runtime.input;
        const overlayHidden = this.isElementHidden(this.overlay);
        const showAction = overlayHidden && !!input?.hasMobilePrimaryAction();
        const showInteract = overlayHidden && !!input?.hasMobileSecondaryAction();

        if (this.mobileHud) {
            this.setElementVisible(this.mobileHud, overlayHidden);
        }

        if (this.mobilePrimaryActionBtn) {
            if (showAction) {
                this.mobilePrimaryActionBtn.textContent = input!.getMobilePrimaryActionLabel() || 'Use';
                this.showElement(this.mobilePrimaryActionBtn);
            } else {
                this.hideElement(this.mobilePrimaryActionBtn);
            }
        }

        if (this.mobileSecondaryActionBtn) {
            if (showInteract) {
                this.mobileSecondaryActionBtn.textContent = input!.getMobileSecondaryActionLabel() || 'Use';
                this.showElement(this.mobileSecondaryActionBtn);
            } else {
                this.hideElement(this.mobileSecondaryActionBtn);
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

    private updateDesktopControlsHint(): void {
        if (!this.desktopControls || this.isMobile) return;
        const mode = this.context.runtime.input?.getDesktopInputMode?.() ?? 'keyboardMouse';
        if (this.desktopHelpMode === mode) return;

        this.desktopHelpMode = mode;
        this.desktopControls.innerHTML = mode === 'controller'
            ? FlatUiRuntime.CONTROLLER_HELP_HTML
            : FlatUiRuntime.KEYBOARD_MOUSE_HELP_HTML;
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

