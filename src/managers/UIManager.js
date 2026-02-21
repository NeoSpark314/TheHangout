// managers/UIManager.js
import eventBus from '../core/EventBus.js';
import gameState from '../core/GameState.js';
import { EVENTS } from '../utils/Constants.js';

export class UIManager {
    constructor() {
        this.overlay = document.getElementById('ui-overlay');
        this.nameInput = document.getElementById('player-name');
        this.joinBtn = document.getElementById('join-btn');
        this.statusText = document.getElementById('status-text');
        this.inviteContainer = document.getElementById('invite-container');
        this.inviteLinkInput = document.getElementById('invite-link');
        this.copyBtn = document.getElementById('copy-btn');
        this.manualRoomGroup = document.getElementById('manual-room-group');
        this.manualRoomInput = document.getElementById('manual-room-id');
        this.startBtn = document.getElementById('start-btn'); // New button to actually start the 3D scene

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

        // The Start button actually hides the UI and drops them into the game
        if (this.startBtn) {
            this.startBtn.addEventListener('click', () => {
                this.hideOverlay();
            });
        }

        // Listen for network events
        eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => {
            if (gameState.isHost && !this.roomIdDisplayed) {
                this.showInviteLink(peerId);
                this.setStatus('Room Created! Share the link, then click Start.');
                this.joinBtn.style.display = 'none'; // Hide create button
                if (this.startBtn) this.startBtn.style.display = 'block'; // Show start button
            } else if (!gameState.isHost) {
                this.setStatus('Connected!');
                setTimeout(() => this.hideOverlay(), 1000); // Guests auto-join
            }
        });
    }

    setupGuestMode(roomId) {
        gameState.isHost = false;
        this.joinBtn.textContent = 'Join Room';
        if (this.manualRoomGroup) this.manualRoomGroup.style.display = 'none';

        this.joinBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Guest';
            gameState.playerName = name;
            this.setStatus('Connecting to host...');
            this.joinBtn.disabled = true;
            eventBus.emit(EVENTS.JOIN_ROOM, roomId);
        });
    }

    setupDefaultMode() {
        gameState.isHost = true; // Assume host unless they type a room ID
        if (this.manualRoomGroup) this.manualRoomGroup.style.display = 'block';

        this.joinBtn.addEventListener('click', () => {
            const name = this.nameInput.value.trim() || 'Player';
            gameState.playerName = name;
            const manualRoomId = this.manualRoomInput ? this.manualRoomInput.value.trim() : '';

            this.joinBtn.disabled = true;

            if (manualRoomId) {
                // They typed a room ID, act as Guest
                gameState.isHost = false;
                this.setStatus('Connecting to host...');
                eventBus.emit(EVENTS.JOIN_ROOM, manualRoomId);
            } else {
                // Creating a room
                gameState.isHost = true;
                this.setStatus('Creating room...');
                eventBus.emit(EVENTS.CREATE_ROOM);
            }
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
}
