/**
 * Mocks a PeerJS DataConnection over WebSockets for restricted networks.
 */
export class RelayConnection {
    constructor(socket, peerId, targetPeerId, isHost) {
        this.listeners = {};
        this.socket = socket;
        this.peer = targetPeerId; // The ID of the person we are talking to
        this.localId = peerId;
        this.open = false;
        this.isHost = isHost;

        // PeerJS compatibility properties
        this.metadata = {};
        this.serialization = 'json';
        this.reliable = true;

        this._init();
    }

    _init() {
        // In a real relay, "open" happens when the socket is ready and the join is confirmed.
        // For simplicity, we'll assume it's open shortly after creation if the socket is already connected.
        if (this.socket.readyState === WebSocket.OPEN) {
            setTimeout(() => {
                this.open = true;
                this.emit('open');
            }, 0);
        } else {
            this.socket.addEventListener('open', () => {
                this.open = true;
                this.emit('open');
            }, { once: true });
        }
    }

    on(event, callback) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    emit(event, data) {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => cb(data));
    }

    send(data) {
        if (this.socket.readyState !== WebSocket.OPEN) return;

        this.socket.send(JSON.stringify({
            type: 'relay',
            target: this.peer,
            payload: data
        }));
    }

    close() {
        // We don't necessarily close the whole socket here, 
        // as it might be shared with other connections in the relay.
        this.open = false;
        this.emit('close');
    }

    // Called by NetworkManager when it receives a relay message for this connection
    handleData(data) {
        this.emit('data', data);
    }
}
