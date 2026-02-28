import eventBus from '../core/EventBus';
import { GameContext } from '../core/GameState';
import { EVENTS } from '../utils/Constants';
import { isMobile } from '../utils/DeviceUtils';
import { IUpdatable } from '../interfaces/IUpdatable';

export class FlatUIManager implements IUpdatable {
    private overlay: HTMLElement;
    private nameInput: HTMLInputElement;
    private createBtn: HTMLButtonElement;
    private dedicatedHostBtn: HTMLButtonElement;
    private joinBtn: HTMLButtonElement;
    private roomInput: HTMLInputElement;
    private copyRoomBtn: HTMLButtonElement;
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
    private isMobile: boolean;
    private _joysticksInitialized: boolean = false;

    constructor(private context: GameContext) {
        this.overlay = document.getElementById('ui-overlay')!;
        this.nameInput = document.getElementById('player-name') as HTMLInputElement;
        this.createBtn = document.getElementById('create-btn') as HTMLButtonElement;
        this.dedicatedHostBtn = document.getElementById('dedicated-host-btn') as HTMLButtonElement;
        this.joinBtn = document.getElementById('join-btn') as HTMLButtonElement;
        this.roomInput = document.getElementById('room-id') as HTMLInputElement;
        this.copyRoomBtn = document.getElementById('copy-room-btn') as HTMLButtonElement;
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
        this.isMobile = isMobile;

        this.init();
        this.showOverlay(); // Ensure it's visible initially
    }

    private init(): void {
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdToJoin = urlParams.get('room');

        if (roomIdToJoin) {
            this.setupGuestMode(roomIdToJoin);
        } else {
            this.setupDefaultMode();
        }

        const networkBadge = document.getElementById('network-mode');
        if (networkBadge) {
            if (this.context.isLocalServer) {
                networkBadge.textContent = '🖥 Local Network';
                networkBadge.classList.add('local');
            } else {
                networkBadge.textContent = '☁ Cloud';
                networkBadge.classList.add('cloud');
            }
        }

        if (this.copyRoomBtn) {
            this.copyRoomBtn.addEventListener('click', () => this.handleInlineCopy());
        }

        if (this.voiceBtn) {
            this.voiceBtn.addEventListener('click', async () => {
                this.ensureAudioContextResumed();
                await this.toggleVoice();
                this.saveToStorage();
            });
        }

        this.nameInput.addEventListener('input', () => {
            this.context.playerName = this.nameInput.value.trim();
            this.saveToStorage();
        });

        this.roomInput.addEventListener('input', () => {
            this.saveToStorage();
        });

        if (this.avatarBtn) {
            this.avatarBtn.addEventListener('click', () => {
                this.avatarDialog.style.display = 'flex';
            });
        }

        if (this.closeAvatarBtn) {
            this.closeAvatarBtn.addEventListener('click', () => {
                this.avatarDialog.style.display = 'none';
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

        // Room UI events are handled in setupGuestMode / setupDefaultMode

        eventBus.on(EVENTS.HOST_READY, (peerId: string) => {
            if (this.context.isHost) {
                this.setStatus('Room Created! Starting...');
                this.ensureAudioContextResumed();
                setTimeout(() => this.hideOverlay(), 1000);
            }
        });

        eventBus.on(EVENTS.PEER_CONNECTED, (peerId: string) => {
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

        this.loadFromStorage();
    }

    public update(delta: number): void {
        if (this.overlay.style.display === 'none' && this.isMobile && !this.context.isDedicatedHost && !this._joysticksInitialized) {
            this.context.managers.input?.initMobileJoysticks();
            this._joysticksInitialized = true;
        }
    }

    private loadFromStorage(): void {
        const storedName = localStorage.getItem('hangout_playerName');
        this.nameInput.value = storedName || `Player-${Math.floor(Math.random() * 10000)}`;

        const storedRoom = localStorage.getItem('hangout_lastRoomId');
        this.roomInput.value = storedRoom || 'TestRoom';

        const storedVoice = localStorage.getItem('hangout_voiceEnabled');
        if (storedVoice === 'true') {
            this.context.voiceEnabled = true;
            this.updateVoiceButton(true);
        }

        const storedColor = localStorage.getItem('hangout_avatarColor');
        if (storedColor) {
            this.context.avatarConfig.color = storedColor;
        } else {
            const palette = ['#00ffff', '#ff00ff', '#39ff14', '#fffd01', '#ff3131', '#bc13fe', '#ff5e00', '#00ff08'];
            const randomColor = palette[Math.floor(Math.random() * palette.length)];
            this.context.avatarConfig.color = randomColor;
            localStorage.setItem('hangout_avatarColor', randomColor);
        }

        if (this.avatarColorInput) this.avatarColorInput.value = this.context.avatarConfig.color as string;
        this.updateAvatarButtonColor(this.context.avatarConfig.color as string);

        this.context.playerName = this.nameInput.value.trim();

        if (this.versionInfo) this.versionInfo.textContent = `v${__APP_VERSION__}`;
        if (this.shaInfo) this.shaInfo.textContent = `build: ${__GIT_SHA__}`;
    }

    private saveToStorage(): void {
        const name = this.nameInput.value.trim();
        const room = this.roomInput.value.trim();
        if (name) {
            localStorage.setItem('hangout_playerName', name);
            this.context.playerName = name;
            eventBus.emit(EVENTS.LOCAL_NAME_UPDATED, name);
        }
        if (this.context.avatarConfig.color) {
            localStorage.setItem('hangout_avatarColor', this.context.avatarConfig.color as string);
        }
        localStorage.setItem('hangout_voiceEnabled', String(this.context.voiceEnabled));
        if (room) {
            localStorage.setItem('hangout_lastRoomId', room);
        }
    }

    private generateReadableRoomId(): string {
        const adjs = ['neon', 'cyber', 'retro', 'pixel', 'synth', 'hyper', 'quantum', 'turbo', 'holo', 'astro'];
        const nouns = ['tiger', 'rider', 'runner', 'punk', 'wave', 'grid', 'nexus', 'core', 'blade', 'nova'];
        const adj = adjs[Math.floor(Math.random() * adjs.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];
        return `${adj}-${noun}-${Math.floor(Math.random() * 100)}`;
    }

    private disableAllButtons(): void {
        this.createBtn.disabled = true;
        if (this.dedicatedHostBtn) this.dedicatedHostBtn.disabled = true;
        this.joinBtn.disabled = true;
    }

    private enableAllButtons(): void {
        this.createBtn.disabled = false;
        if (this.dedicatedHostBtn) this.dedicatedHostBtn.disabled = false;
        this.joinBtn.disabled = false;
    }

    private setupGuestMode(roomId: string): void {
        this.context.isHost = false;
        if (this.createBtn) this.createBtn.style.display = 'none';
        this.roomInput.value = roomId;
        this.joinBtn.addEventListener('click', async () => {
            this.ensureAudioContextResumed();
            this.context.playerName = this.nameInput.value.trim() || 'Guest';
            if (this.context.voiceEnabled) {
                await this.context.managers.media.toggleMicrophone();
            }
            this.setStatus('Connecting to host...');
            this.joinBtn.disabled = true;
            eventBus.emit(EVENTS.JOIN_ROOM, this.roomInput.value.trim() || roomId);
        });
    }

    private setupDefaultMode(): void {
        if (this.context.isLocalServer) {
            this.createBtn.style.display = 'none';
            if (this.dedicatedHostBtn) this.dedicatedHostBtn.style.display = 'none';

            this.joinBtn.textContent = 'Enter Hangout';
            this.joinBtn.classList.remove('secondary-btn');
            this.joinBtn.classList.add('primary-btn');

            this.joinBtn.addEventListener('click', async () => {
                this.ensureAudioContextResumed();
                this.context.playerName = this.nameInput.value.trim() || 'Player';
                if (this.context.voiceEnabled) {
                    await this.context.managers.media.toggleMicrophone();
                }
                const targetId = this.roomInput.value.trim() || this.generateReadableRoomId();
                this.roomInput.value = targetId; // populate if random generated
                this.disableAllButtons();
                this.clearError();
                this.saveToStorage();

                this.context.isHost = false;
                this.setStatus('Connecting to headless server...');
                eventBus.emit(EVENTS.JOIN_ROOM, targetId);
            });
            return;
        }

        this.createBtn.addEventListener('click', async () => {
            this.ensureAudioContextResumed();
            this.context.playerName = this.nameInput.value.trim() || 'Host';
            if (this.context.voiceEnabled) {
                await this.context.managers.media.toggleMicrophone();
            }
            const customId = this.roomInput.value.trim() || this.generateReadableRoomId();
            this.disableAllButtons();
            this.clearError();
            this.saveToStorage();

            this.context.isHost = true;
            this.setStatus('Creating room...');
            eventBus.emit(EVENTS.CREATE_ROOM, customId);
        });

        if (this.dedicatedHostBtn) {
            this.dedicatedHostBtn.addEventListener('click', async () => {
                if (this.context.voiceEnabled) {
                    this.ensureAudioContextResumed();
                    await this.context.managers.media.toggleMicrophone();
                }
                const customId = this.roomInput.value.trim() || this.generateReadableRoomId();
                this.disableAllButtons();
                this.clearError();
                this.saveToStorage();
                this.context.playerName = 'Host';
                this.context.isHost = true;
                this.context.isDedicatedHost = true;
                this.setStatus('Creating dedicated room...');
                eventBus.emit(EVENTS.CREATE_ROOM, customId);
            });
        }

        this.joinBtn.addEventListener('click', async () => {
            this.ensureAudioContextResumed();
            this.context.playerName = this.nameInput.value.trim() || 'Player';
            if (this.context.voiceEnabled) {
                await this.context.managers.media.toggleMicrophone();
            }
            const targetId = this.roomInput.value.trim();
            if (!targetId) {
                this.setStatus('Please enter a Room Name to join.');
                return;
            }
            this.disableAllButtons();
            this.clearError();
            this.saveToStorage();
            this.context.isHost = false;
            this.setStatus('Connecting to host...');
            eventBus.emit(EVENTS.JOIN_ROOM, targetId);
        });
    }

    private handleInlineCopy(): void {
        const roomId = this.roomInput.value.trim() || 'TestRoom';
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomId);
        const originalIcon = this.copyRoomBtn.textContent;
        navigator.clipboard.writeText(url.toString()).then(() => {
            this.copyRoomBtn.textContent = '✅';
            setTimeout(() => { this.copyRoomBtn.textContent = originalIcon; }, 2000);
        }).catch(() => { this.setStatus('Copy failed.'); });
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
        if (this.overlay) {
            this.overlay.style.opacity = '0';
            setTimeout(() => {
                this.overlay.style.display = 'none';
                if (this.desktopControls && !this.isMobile) {
                    this.desktopControls.style.display = 'block';
                }
                if (this.isMobile && !this.context.isDedicatedHost) {
                    const hud = document.getElementById('mobile-hud');
                    if (hud) {
                        hud.style.display = 'flex';
                        this.context.managers.input?.initMobileJoysticks();
                        this._joysticksInitialized = true;
                    }
                }
            }, 500);
        }
    }

    private ensureAudioContextResumed(): void {
        if (this.context.managers.render && this.context.managers.render.audioListener) {
            if (this.context.managers.render.audioListener.context.state === 'suspended') {
                this.context.managers.render.audioListener.context.resume();
            }
        }
    }

    public getNavigableElements(): HTMLElement[] {
        if (!this.overlay || this.overlay.style.display === 'none') return [];
        const elements: HTMLElement[] = [];
        if (this.nameInput && this.nameInput.offsetParent) elements.push(this.nameInput);
        if (this.roomInput && this.roomInput.offsetParent) elements.push(this.roomInput);
        if (this.copyRoomBtn && this.copyRoomBtn.offsetParent) elements.push(this.copyRoomBtn);
        if (this.createBtn && this.createBtn.offsetParent) elements.push(this.createBtn);
        if (this.dedicatedHostBtn && this.dedicatedHostBtn.offsetParent) elements.push(this.dedicatedHostBtn);
        if (this.joinBtn && this.joinBtn.offsetParent) elements.push(this.joinBtn);
        if (this.voiceBtn && this.voiceBtn.offsetParent) elements.push(this.voiceBtn);
        return elements;
    }

    private async toggleVoice(): Promise<void> {
        this.context.voiceEnabled = !this.context.voiceEnabled;
        this.updateVoiceButton(this.context.voiceEnabled);
    }

    private updateVoiceButton(enabled: boolean): void {
        if (!this.voiceBtn) return;
        if (enabled) {
            this.voiceBtn.textContent = 'Voice: ON';
            this.voiceBtn.classList.add('ready');
        } else {
            this.voiceBtn.textContent = 'Voice: OFF';
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
        if (this.overlay) {
            this.overlay.style.display = 'flex';
            this.overlay.offsetHeight;
            this.overlay.style.opacity = '1';
        }
        if (this.desktopControls) this.desktopControls.style.display = 'none';
        const hud = document.getElementById('mobile-hud');
        if (hud) hud.style.display = 'none';
    }

    private handleLeave(): void {
        if (this.context.managers.network) this.context.managers.network.disconnect();
        if (this.context.managers.media) this.context.managers.media.stopMicrophone();
        if (this.context.managers.entity) {
            const entities = Array.from(this.context.managers.entity.entities.values());
            entities.forEach(entity => {
                if (entity.type !== 'LOCAL_PLAYER') {
                    this.context.managers.entity!.removeEntity(entity.id);
                }
            });
        }
        this.context.isDedicatedHost = false;
        this.showOverlay();
        this.setStatus('Ready');
        this.enableAllButtons();
    }
}
