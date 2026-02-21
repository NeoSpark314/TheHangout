// managers/UIManager.js
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class UIManager {
    constructor() {
        this.overlay = document.getElementById('ui-overlay');
        this.nameInput = document.getElementById('player-name');

        this.createBtn = document.getElementById('create-btn');
        this.joinBtn = document.getElementById('join-btn');
        this.roomInput = document.getElementById('room-id');
        this.copyRoomBtn = document.getElementById('copy-room-btn');

        // Handle Orientation Change to reposition joysticks
        window.addEventListener('orientationchange', () => {
            if (this.isMobile && this.overlay.style.display === 'none') {
                gameState.managers.input.initMobileJoysticks();
            }
        });

        this.statusText = document.getElementById('status-text');
        this.errorText = document.getElementById('error-text');
        this.versionInfo = document.getElementById('app-version');
        this.shaInfo = document.getElementById('git-sha');

        // Detect mobile (non-HMD) for dual sticks
        this.isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) &&
            !/OculusBrowser|PicoBrowser|ViveBrowser|AppleVision/i.test(navigator.userAgent);

        this.init();
    }

    init() {
        // Check URL parameters for a room ID
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdToJoin = urlParams.get('room');

        if (roomIdToJoin) {
            // Guest mode via URL
            this.setupGuestMode(roomIdToJoin);
        } else {
            // Default mode: can create or manually join
            this.setupDefaultMode();
        }

        this.voiceBtn = document.getElementById('voice-btn');

        if (this.copyRoomBtn) {
            this.copyRoomBtn.addEventListener('click', () => this.handleInlineCopy());
        }

        // Voice chat toggle
        if (this.voiceBtn) {
            this.voiceBtn.addEventListener('click', async () => {
                this.ensureAudioContextResumed();
                const isActive = await gameState.managers.media.toggleMicrophone();
                if (isActive) {
                    this.voiceBtn.textContent = 'Disable Voice Chat';
                    this.voiceBtn.style.backgroundColor = '#ef4444'; // Red for active mic
                } else {
                    this.voiceBtn.textContent = 'Enable Voice Chat';
                    this.voiceBtn.style.backgroundColor = '#3b82f6'; // Blue for idle
                }
            });
        }

        // --- Instant Sync ---
        this.nameInput.addEventListener('input', () => {
            gameState.playerName = this.nameInput.value.trim();
            this.saveToStorage();
        });

        this.roomInput.addEventListener('input', () => {
            this.saveToStorage();
        });



        // Listen for network events
        eventBus.on(EVENTS.HOST_READY, (peerId) => {
            if (gameState.isHost) {
                this.setStatus('Room Created! Starting...');
                this.ensureAudioContextResumed();
                // One-click host: hide immediately
                setTimeout(() => this.hideOverlay(), 1000);
            }
        });

        eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => {
            // Note: Host no longer receives this for itself due to fix
            if (!gameState.isHost) {
                this.setStatus('Connected!');
                setTimeout(() => this.hideOverlay(), 1000); // Guests auto-join
            }
        });

        eventBus.on(EVENTS.NETWORK_ERROR, (err) => {
            this.showError(err);
            this.enableAllButtons();
            this.setStatus('Ready'); // Clear the "Connecting..." status
        });

        this.loadFromStorage();
    }

    loadFromStorage() {
        const storedName = localStorage.getItem('hangout_playerName');
        if (storedName) {
            this.nameInput.value = storedName;
        } else {
            // Generate a random name if none exists
            this.nameInput.value = `Player-${Math.floor(Math.random() * 10000)}`;
        }

        const storedRoom = localStorage.getItem('hangout_lastRoomId');
        if (storedRoom) {
            this.roomInput.value = storedRoom;
        } else {
            this.roomInput.value = 'TestRoom';
        }

        // Initialize gameState immediately
        gameState.playerName = this.nameInput.value.trim();

        // Set version and SHA
        if (this.versionInfo) {
            this.versionInfo.textContent = `v${__APP_VERSION__}`;
        }
        if (this.shaInfo) {
            this.shaInfo.textContent = `build: ${__GIT_SHA__}`;
        }
    }

    saveToStorage() {
        const name = this.nameInput.value.trim();
        const room = this.roomInput.value.trim();

        if (name) {
            localStorage.setItem('hangout_playerName', name);
            gameState.playerName = name;
        }

        // Only save the room ID if it's not a temporary/generated one or if we are actively joining a specific one
        if (room) {
            localStorage.setItem('hangout_lastRoomId', room);
        }
    }

    generateReadableRoomId() {
        const adjs = ['neon', 'cyber', 'retro', 'pixel', 'synth', 'hyper', 'quantum', 'turbo', 'holo', 'astro'];
        const nouns = ['tiger', 'rider', 'runner', 'punk', 'wave', 'grid', 'nexus', 'core', 'blade', 'nova'];
        const num = Math.floor(Math.random() * 100);

        const adj = adjs[Math.floor(Math.random() * adjs.length)];
        const noun = nouns[Math.floor(Math.random() * nouns.length)];

        return `${adj}-${noun}-${num}`;
    }



    disableAllButtons() {
        if (this.createBtn) this.createBtn.disabled = true;
        if (this.joinBtn) this.joinBtn.disabled = true;
    }

    enableAllButtons() {
        if (this.createBtn) this.createBtn.disabled = false;
        if (this.joinBtn) this.joinBtn.disabled = false;
    }

    setupGuestMode(roomId) {
        gameState.isHost = false;

        // Hide create button since we are in guest mode (direct link)
        if (this.createBtn) this.createBtn.style.display = 'none';

        this.roomInput.value = roomId;

        this.joinBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Guest';
            gameState.playerName = name;
            this.setStatus('Connecting to host...');
            this.joinBtn.disabled = true;
            eventBus.emit(EVENTS.JOIN_ROOM, this.roomInput.value.trim() || roomId);
        });
    }

    setupDefaultMode() {
        // Create Room Flow
        this.createBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Host';
            gameState.playerName = name;

            // Generate a readable ID if the user didn't provide one
            const customId = this.roomInput.value.trim() || this.generateReadableRoomId();

            this.disableAllButtons();

            // Clear any old UI errors
            this.clearError();

            this.saveToStorage();

            gameState.isHost = true;
            this.setStatus('Creating room...');

            // Pass custom ID to CREATE_ROOM event
            eventBus.emit(EVENTS.CREATE_ROOM, customId);
        });

        // Join Room Flow
        this.joinBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Player';
            gameState.playerName = name;
            const targetId = this.roomInput.value.trim();

            if (!targetId) {
                this.setStatus('Please enter a Room Name to join.');
                return;
            }

            this.disableAllButtons();
            this.clearError();

            this.saveToStorage();

            gameState.isHost = false;
            this.setStatus('Connecting to host...');
            eventBus.emit(EVENTS.JOIN_ROOM, targetId);
        });
    }

    handleInlineCopy() {
        const roomId = this.roomInput.value.trim() || 'TestRoom';
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomId);

        const originalIcon = this.copyRoomBtn.textContent;
        navigator.clipboard.writeText(url.toString()).then(() => {
            this.copyRoomBtn.textContent = '✅';
            setTimeout(() => {
                this.copyRoomBtn.textContent = originalIcon;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            this.setStatus('Copy failed.');
        });
    }

    setStatus(msg) {
        if (this.statusText) {
            this.statusText.textContent = msg;
        }
    }

    showError(msg) {
        if (this.errorText) {
            this.errorText.textContent = msg;
        }
    }

    clearError() {
        if (this.errorText) {
            this.errorText.textContent = "";
        }
    }

    hideOverlay() {
        if (this.overlay) {
            this.overlay.style.opacity = '0';
            setTimeout(() => {
                this.overlay.style.display = 'none';

                // Show mobile joysticks if on phone/tablet
                if (this.isMobile) {
                    const hud = document.getElementById('mobile-hud');
                    if (hud) {
                        hud.style.display = 'flex';
                        gameState.managers.input.initMobileJoysticks();
                    }
                }
            }, 500);
        }
    }

    ensureAudioContextResumed() {
        if (gameState.managers.render && gameState.managers.render.audioListener) {
            if (gameState.managers.render.audioListener.context.state === 'suspended') {
                gameState.managers.render.audioListener.context.resume();
            }
        }
    }

    getNavigableElements() {
        if (!this.overlay || this.overlay.style.display === 'none') return [];

        const elements = [];
        // Sequential navigation order
        if (this.nameInput && this.nameInput.offsetParent) elements.push(this.nameInput);
        if (this.roomInput && this.roomInput.offsetParent) elements.push(this.roomInput);
        if (this.copyRoomBtn && this.copyRoomBtn.offsetParent) elements.push(this.copyRoomBtn);
        if (this.createBtn && this.createBtn.offsetParent) elements.push(this.createBtn);
        if (this.joinBtn && this.joinBtn.offsetParent) elements.push(this.joinBtn);
        if (this.voiceBtn && this.voiceBtn.offsetParent) elements.push(this.voiceBtn);

        return elements;
    }
}
