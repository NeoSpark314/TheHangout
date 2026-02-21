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

        this.init();
    }

    init() {
        // Check URL parameters for a room ID
        const urlParams = new URLSearchParams(window.location.search);
        const roomIdToJoin = urlParams.get('room');

        if (roomIdToJoin) {
            // Guest mode
            gameState.isHost = false;
            this.joinBtn.textContent = 'Join Room';
            this.joinBtn.addEventListener('click', () => {
                const name = this.nameInput.value.trim() || 'Guest';
                gameState.playerName = name;
                this.setStatus('Connecting to host...');
                eventBus.emit(EVENTS.JOIN_ROOM, roomIdToJoin);
            });
        } else {
            // Host mode
            gameState.isHost = true;
            this.joinBtn.textContent = 'Create Room';
            this.joinBtn.addEventListener('click', () => {
                const name = this.nameInput.value.trim() || 'Host';
                gameState.playerName = name;
                this.setStatus('Creating room...');
                eventBus.emit(EVENTS.CREATE_ROOM);
            });
        }

        this.copyBtn.addEventListener('click', () => {
            this.inviteLinkInput.select();
            document.execCommand('copy');
            this.copyBtn.textContent = 'Copied!';
            setTimeout(() => {
                this.copyBtn.textContent = 'Copy';
            }, 2000);
        });

        // Listen for network events
        eventBus.on(EVENTS.PEER_CONNECTED, (peerId) => {
            if (gameState.isHost && !this.roomIdDisplayed) {
                this.showInviteLink(peerId);
            }
            this.setStatus('Connected!');
            setTimeout(() => this.hideOverlay(), 1000);
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
