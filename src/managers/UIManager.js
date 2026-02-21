// managers/UIManager.js
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class UIManager {
    constructor() {
        this.overlay = document.getElementById('ui-overlay');
        this.nameInput = document.getElementById('player-name');

        this.createBtn = document.getElementById('create-btn');
        this.createRoomInput = document.getElementById('create-room-id');

        this.joinBtn = document.getElementById('join-btn');
        this.joinRoomInput = document.getElementById('join-room-id');

        this.statusText = document.getElementById('status-text');
        this.inviteContainer = document.getElementById('invite-container');
        this.inviteLinkInput = document.getElementById('invite-link');
        this.copyBtn = document.getElementById('copy-btn');
        this.startBtn = document.getElementById('start-btn'); // New button to actually start the 3D scene

        this.debugHostBtn = document.getElementById('debug-host-btn');
        this.debugJoinBtn = document.getElementById('debug-join-btn');

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

        this.copyBtn.addEventListener('click', () => {
            this.inviteLinkInput.select();
            // Use modern clipboard API if available
            if (navigator.clipboard) {
                navigator.clipboard.writeText(this.inviteLinkInput.value);
            } else {
                document.execCommand('copy');
            }
            this.copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                this.copyBtn.textContent = 'Copy';
            }, 2000);
        });

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

        // The Start button actually hides the UI and drops them into the game
        if (this.startBtn) {
            this.startBtn.addEventListener('click', () => {
                this.ensureAudioContextResumed();
                this.hideOverlay();
            });
        }

        // Listen for network events
        eventBus.on(EVENTS.HOST_READY, (peerId) => {
            if (gameState.isHost) {
                this.showInviteLink(peerId);
                this.setStatus('Room Created! Share the link, then click Start.');

                // Hide inputs, show start
                if (this.createBtn) this.createBtn.parentElement.style.display = 'none';
                if (this.joinBtn) this.joinBtn.parentElement.style.display = 'none';
                document.querySelector('.action-separator').style.display = 'none';

                if (this.startBtn) this.startBtn.style.display = 'block';
            }
        });

        eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => {
            // Note: Host no longer receives this for itself due to fix
            if (!gameState.isHost) {
                this.setStatus('Connected!');
                setTimeout(() => this.hideOverlay(), 1000); // Guests auto-join
            }
        });

        this.loadFromStorage();
        this.setupDebugButtons();
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
            this.joinRoomInput.value = storedRoom;
        }
    }

    saveToStorage() {
        if (this.nameInput.value.trim()) {
            localStorage.setItem('hangout_playerName', this.nameInput.value.trim());
        }
        if (this.joinRoomInput.value.trim() && !gameState.isHost) {
            localStorage.setItem('hangout_lastRoomId', this.joinRoomInput.value.trim());
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

    setupDebugButtons() {
        if (this.debugHostBtn) {
            this.debugHostBtn.addEventListener('click', () => {
                const name = this.nameInput.value.trim() || 'DebugHost';
                gameState.playerName = name;
                gameState.isHost = true;

                this.disableAllButtons();
                this.setStatus('Creating Local Debug Room...');
                eventBus.emit(EVENTS.CREATE_ROOM, 'local-debug');
            });
        }

        if (this.debugJoinBtn) {
            this.debugJoinBtn.addEventListener('click', () => {
                const name = this.nameInput.value.trim() || 'DebugGuest';
                gameState.playerName = name;
                gameState.isHost = false;

                this.disableAllButtons();
                this.setStatus('Joining Local Debug Room...');
                eventBus.emit(EVENTS.JOIN_ROOM, 'local-debug');
            });
        }
    }

    disableAllButtons() {
        if (this.createBtn) this.createBtn.disabled = true;
        if (this.joinBtn) this.joinBtn.disabled = true;
        if (this.debugHostBtn) this.debugHostBtn.disabled = true;
        if (this.debugJoinBtn) this.debugJoinBtn.disabled = true;
    }

    setupGuestMode(roomId) {
        gameState.isHost = false;

        // Hide create UI
        if (this.createBtn) this.createBtn.parentElement.style.display = 'none';
        document.querySelector('.action-separator').style.display = 'none';

        this.joinRoomInput.value = roomId;

        this.joinBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Guest';
            gameState.playerName = name;
            this.setStatus('Connecting to host...');
            this.joinBtn.disabled = true;
            eventBus.emit(EVENTS.JOIN_ROOM, this.joinRoomInput.value.trim() || roomId);
        });
    }

    setupDefaultMode() {
        // Create Room Flow
        this.createBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Host';
            gameState.playerName = name;

            // Generate a readable ID if the user didn't provide one
            const customId = this.createRoomInput.value.trim() || this.generateReadableRoomId();

            this.disableAllButtons();

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
            const targetId = this.joinRoomInput.value.trim();

            if (!targetId) {
                this.setStatus('Please enter a Room Name to join.');
                return;
            }

            this.disableAllButtons();

            this.saveToStorage();

            gameState.isHost = false;
            this.setStatus('Connecting to host...');
            eventBus.emit(EVENTS.JOIN_ROOM, targetId);
        });
    }

    showInviteLink(roomId) {
        this.roomIdDisplayed = true;
        this.inviteContainer.style.display = 'block';

        // Generate URL
        const url = new URL(window.location.href);
        url.searchParams.set('room', roomId);
        this.inviteLinkInput.value = url.toString();
    }

    setStatus(msg) {
        if (this.statusText) {
            this.statusText.textContent = msg;
        }
    }

    hideOverlay() {
        if (this.overlay) {
            this.overlay.style.opacity = '0';
            setTimeout(() => {
                this.overlay.style.display = 'none';
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
}
