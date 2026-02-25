export class RelayConnection {
    private listeners: Record<string, Function[]> = {};
    private socket: WebSocket;
    public peer: string;
    public localId: string;
    public open: boolean = false;
    public isHost: boolean;

    public metadata: any = {};
    public serialization: string = 'json';
    public isReliable: boolean = true;

    constructor(socket: WebSocket, peerId: string, targetPeerId: string, isHost: boolean) {
        this.socket = socket;
        this.peer = targetPeerId;
        this.localId = peerId;
        this.isHost = isHost;

        this._init();
    }

    private _init(): void {
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

    public on(event: string, callback: Function): void {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(callback);
    }

    public emit(event: string, data?: any): void {
        if (!this.listeners[event]) return;
        this.listeners[event].forEach(cb => cb(data));
    }

    public send(data: any): void {
        if (this.socket.readyState !== WebSocket.OPEN) return;

        this.socket.send(JSON.stringify({
            type: 'relay',
            target: this.peer,
            payload: data
        }));
    }

    public close(): void {
        this.open = false;
        this.emit('close');
    }

    public handleData(data: any): void {
        this.emit('data', data);
    }
}
