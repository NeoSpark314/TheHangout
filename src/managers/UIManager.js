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

        // Face UI
        this.faceUi = document.getElementById('face-ui');
        this.faceCanvas = document.getElementById('face-canvas');
        this.faceCtx = this.faceCanvas ? this.faceCanvas.getContext('2d') : null;
        this.faceClearBtn = document.getElementById('face-clear-btn');
        this.faceCloseBtn = document.getElementById('face-close-btn');
        this.faceToggleBtn = document.getElementById('face-toggle-btn');

        this.drawing = false;
        this.lastX = 0;
        this.lastY = 0;

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
                // Show face toggle once game starts
                if (this.faceToggleBtn) this.faceToggleBtn.style.display = 'flex';
            });
        }

        this.initFaceDrawing();

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
            const customId = this.createRoomInput.value.trim();

            this.createBtn.disabled = true;
            this.joinBtn.disabled = true;

            gameState.isHost = true;
            this.setStatus('Creating room...');

            // Pass custom ID (if any) to CREATE_ROOM event
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

            this.createBtn.disabled = true;
            this.joinBtn.disabled = true;

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

    initFaceDrawing() {
        if (!this.faceCanvas || !this.faceCtx) return;

        // Setup Brush
        this.faceCtx.strokeStyle = '#00ffff';
        this.faceCtx.lineWidth = 12;
        this.faceCtx.lineCap = 'round';
        this.faceCtx.lineJoin = 'round';

        const getPos = (e) => {
            const rect = this.faceCanvas.getBoundingClientRect();
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            return {
                x: (clientX - rect.left) * (this.faceCanvas.width / rect.width),
                y: (clientY - rect.top) * (this.faceCanvas.height / rect.height)
            };
        };

        const startDrawing = (e) => {
            this.drawing = true;
            const { x, y } = getPos(e);
            this.lastX = x;
            this.lastY = y;
        };

        const draw = (e) => {
            if (!this.drawing) return;
            e.preventDefault();
            const { x, y } = getPos(e);

            this.faceCtx.beginPath();
            this.faceCtx.moveTo(this.lastX, this.lastY);
            this.faceCtx.lineTo(x, y);
            this.faceCtx.stroke();

            this.lastX = x;
            this.lastY = y;
        };

        const stopDrawing = () => {
            if (this.drawing) {
                this.drawing = false;
                eventBus.emit(EVENTS.DRAWING_UPDATED, this.faceCanvas.toDataURL());
            }
        };

        this.faceCanvas.addEventListener('mousedown', startDrawing);
        this.faceCanvas.addEventListener('mousemove', draw);
        window.addEventListener('mouseup', stopDrawing);

        this.faceCanvas.addEventListener('touchstart', startDrawing);
        this.faceCanvas.addEventListener('touchmove', draw);
        window.addEventListener('touchend', stopDrawing);

        this.faceClearBtn.addEventListener('click', () => {
            this.faceCtx.fillStyle = '#0a041c';
            this.faceCtx.fillRect(0, 0, this.faceCanvas.width, this.faceCanvas.height);
            // Re-stroke border
            this.faceCtx.strokeStyle = '#00ffff';
            this.faceCtx.lineWidth = 10;
            this.faceCtx.strokeRect(10, 10, 236, 236);

            eventBus.emit(EVENTS.DRAWING_UPDATED, this.faceCanvas.toDataURL());
        });

        this.faceCloseBtn.addEventListener('click', () => {
            this.faceUi.style.display = 'none';
            this.faceToggleBtn.style.display = 'flex';
        });

        this.faceToggleBtn.addEventListener('click', () => {
            this.faceUi.style.display = 'flex';
            this.faceToggleBtn.style.display = 'none';
        });

        // Initial clear to set background
        this.faceClearBtn.click();
    }
}
