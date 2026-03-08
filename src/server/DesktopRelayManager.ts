import { WebSocket, WebSocketServer } from 'ws';
import https from 'https';
import { PACKET_TYPES } from '../shared/constants/Constants.ts';
import {
    IDesktopSourcesStatusResponsePayload,
    IDesktopSourcesStatusRequestPayload,
    IDesktopStreamSummonPayload,
    IDesktopStreamStopPayload
} from '../shared/contracts/INetworkPacket.ts';
import { HeadlessSession } from './HeadlessSession.ts';

export class DesktopRelayManager {
    private globalDesktopSources = new Map<string, WebSocket>();
    private desktopSourceBySocket = new WeakMap<WebSocket, string>();
    private desktopRoutes = new Map<string, {
        sessionId: string;
        name?: string;
        summonedBy: string;
        summonerName?: string;
        anchor?: [number, number, number];
        quaternion?: [number, number, number, number];
    }>();
    private capturingKeys = new Set<string>();
    private relaySourceSubscriptions = new Map<WebSocket, { sessionId: string; keys: Set<string> }>();

    constructor(
        private activeSessions: Map<string, HeadlessSession>,
        private sendPacketToSession: (sessionId: string, type: number, payload: unknown) => void,
        private sendBinaryToSession: (sessionId: string, data: Buffer) => void
    ) { }

    public handleUpgrade(pathname: string, request: any, socket: any, head: any, wssRelay: WebSocketServer, wssDesktop: WebSocketServer): boolean {
        if (pathname === '/relay') {
            console.log('[Server] Routing to Relay...');
            wssRelay.handleUpgrade(request, socket, head, (ws) => {
                console.log('[Server] Relay Handshake Complete');
                wssRelay.emit('connection', ws, request);
            });
            return true;
        } else if (pathname === '/desktop-source') {
            console.log('[Server] Routing to Desktop Source...');
            wssDesktop.handleUpgrade(request, socket, head, (ws) => {
                console.log('[Server] Desktop Source Handshake Complete');
                wssDesktop.emit('connection', ws, request);
            });
            return true;
        }
        return false;
    }

    public handleRelayConnection(ws: WebSocket, sessionId: string, peerId: string, data: any): boolean {
        if (data.type === PACKET_TYPES.DESKTOP_SOURCES_STATUS_REQUEST) {
            const payload = (data.payload || {}) as IDesktopSourcesStatusRequestPayload;
            const keys = Array.isArray(payload.keys)
                ? payload.keys.filter((k): k is string => typeof k === 'string' && k.trim().length > 0)
                : [];
            this.relaySourceSubscriptions.set(ws, {
                sessionId: sessionId,
                keys: new Set(keys)
            });

            this.sendSourceStatusToClient(ws, sessionId, keys);
            return true;
        }

        if (data.type === PACKET_TYPES.DESKTOP_STREAM_SUMMON) {
            const payload = (data.payload || {}) as IDesktopStreamSummonPayload;
            const key = typeof payload.key === 'string' ? payload.key.trim() : '';
            if (!key) return true;

            const sourceWs = this.globalDesktopSources.get(key);
            if (!sourceWs || sourceWs.readyState !== 1) {
                this.sendPacketToSession(sessionId, PACKET_TYPES.DESKTOP_STREAM_OFFLINE, {
                    key,
                    sessionId: sessionId
                });
                return true;
            }

            this.desktopRoutes.set(key, {
                sessionId: sessionId,
                name: payload.name,
                summonedBy: peerId,
                summonerName: payload.summonerName || 'Someone',
                anchor: payload.anchor,
                quaternion: payload.quaternion
            });
            this.notifySubscribedClientsForKey(key);

            this.sendPacketToSession(sessionId, PACKET_TYPES.DESKTOP_STREAM_SUMMONED, {
                key,
                name: payload.name,
                sessionId: sessionId,
                anchor: payload.anchor,
                quaternion: payload.quaternion,
                summonedByPeerId: peerId,
                summonedByName: payload.summonerName || 'Someone'
            });

            this.sendPacketToSession(sessionId, PACKET_TYPES.SESSION_NOTIFICATION, {
                kind: 'desktop_stream_started',
                actorPeerId: peerId,
                actorName: payload.name || 'Someone',
                subjectName: payload.name || key,
                sentAt: Date.now()
            });
            return true;
        }

        if (data.type === PACKET_TYPES.DESKTOP_STREAM_STOP) {
            const payload = (data.payload || {}) as IDesktopStreamStopPayload;
            const key = typeof payload.key === 'string' ? payload.key.trim() : '';
            if (!key) return true;
            const route = this.desktopRoutes.get(key);
            if (!route || route.sessionId !== sessionId) return true;

            this.desktopRoutes.delete(key);
            this.notifySubscribedClientsForKey(key);
            this.sendPacketToSession(sessionId, PACKET_TYPES.DESKTOP_STREAM_STOPPED, {
                key,
                sessionId: sessionId
            });

            this.sendPacketToSession(sessionId, PACKET_TYPES.SESSION_NOTIFICATION, {
                kind: 'desktop_stream_stopped',
                actorPeerId: peerId,
                subjectName: route?.name || key,
                sentAt: Date.now()
            });
            return true;
        }

        return false;
    }

    public handleRelayDisconnect(ws: WebSocket, peerId: string, sessionId: string): void {
        this.relaySourceSubscriptions.delete(ws);

        for (const [key, route] of this.desktopRoutes.entries()) {
            if (route.summonedBy === peerId && route.sessionId === sessionId) {
                this.desktopRoutes.delete(key);
                this.notifySubscribedClientsForKey(key);
                this.sendPacketToSession(sessionId, PACKET_TYPES.DESKTOP_STREAM_STOPPED, {
                    key,
                    sessionId: sessionId
                });

                this.sendPacketToSession(sessionId, PACKET_TYPES.SESSION_NOTIFICATION, {
                    kind: 'desktop_stream_stopped',
                    actorPeerId: 'system',
                    actorName: 'System',
                    subjectName: route.name || key,
                    message: `Screen stopped because the owner left the session.`,
                    sentAt: Date.now()
                });
            }
        }
    }

    public handleDesktopSourceMessage(ws: WebSocket, message: any): void {
        try {
            if (Buffer.isBuffer(message)) {
                const firstByte = message.readUInt8(0);
                if (firstByte === PACKET_TYPES.DESKTOP_STREAM_FRAME) {
                    const keyLen = message.readUInt8(1);
                    const key = message.toString('utf8', 2, 2 + keyLen);

                    if (this.capturingKeys.has(key)) {
                        const route = this.desktopRoutes.get(key);
                        if (route && route.sessionId) {
                            const session = this.activeSessions.get(route.sessionId);
                            if (session) {
                                session.network.bytesReceived += message.length;
                                session.context.runtime.diagnostics.recordNetworkReceived(message.length);
                            }
                            this.sendBinaryToSession(route.sessionId, message);
                        }
                    }
                    return;
                }
            }

            const data = typeof message === 'string' ? JSON.parse(message) : JSON.parse(message.toString());

            if (data.type === 'register-global-source') {
                const nextKey = typeof data.key === 'string' ? data.key.trim() : '';
                if (!nextKey) {
                    ws.send(JSON.stringify({ type: 'source-error', message: 'Missing key' }));
                    return;
                }

                const existingWs = this.globalDesktopSources.get(nextKey);
                const hadCollision = !!existingWs && existingWs !== ws;
                if (existingWs && existingWs !== ws) {
                    try {
                        existingWs.send(JSON.stringify({ type: 'source-error', message: 'Replaced by a new source with same key' }));
                        existingWs.close();
                    } catch { }
                }

                this.globalDesktopSources.set(nextKey, ws);
                this.desktopSourceBySocket.set(ws, nextKey);
                this.notifySubscribedClientsForKey(nextKey);

                ws.send(JSON.stringify({
                    type: 'source-registered',
                    key: nextKey,
                    collision: hadCollision
                }));
            } else if (data.type === 'source-capture-started') {
                const key = typeof data.key === 'string' ? data.key.trim() : '';
                if (!key) return;
                this.capturingKeys.add(key);
                this.notifySubscribedClientsForKey(key);
            } else if (data.type === 'source-capture-stopped') {
                const key = typeof data.key === 'string' ? data.key.trim() : '';
                if (!key) return;
                this.capturingKeys.delete(key);
                this.notifySubscribedClientsForKey(key);

                const route = this.desktopRoutes.get(key);
                if (route) {
                    this.sendPacketToSession(route.sessionId, PACKET_TYPES.SESSION_NOTIFICATION, {
                        kind: 'desktop_stream_stopped',
                        subjectName: route.name || key,
                        sentAt: Date.now()
                    });
                }
            }
        } catch (e) {
            console.error('[DesktopRelayManager] Error:', e);
        }
    }

    public handleDesktopSourceDisconnect(ws: WebSocket): void {
        const key = this.desktopSourceBySocket.get(ws);
        if (!key) return;

        if (this.globalDesktopSources.get(key) === ws) {
            this.globalDesktopSources.delete(key);
            this.capturingKeys.delete(key);
        }
        this.desktopSourceBySocket.delete(ws);
        this.notifySubscribedClientsForKey(key);

        const route = this.desktopRoutes.get(key);
        if (route) {
            this.desktopRoutes.delete(key);
            this.notifySubscribedClientsForKey(key);
            this.sendPacketToSession(route.sessionId, PACKET_TYPES.DESKTOP_STREAM_OFFLINE, {
                key,
                sessionId: route.sessionId
            });
        }
    }

    public stopRoutedStreamsForSession(sessionId: string): void {
        for (const [key, route] of Array.from(this.desktopRoutes.entries())) {
            if (route.sessionId !== sessionId) continue;
            this.desktopRoutes.delete(key);
            this.notifySubscribedClientsForKey(key);
        }
    }

    private notifySubscribedClientsForKey(key: string): void {
        const route = this.desktopRoutes.get(key);
        const sourceWs = this.globalDesktopSources.get(key);
        if (sourceWs && sourceWs.readyState === 1) {
            sourceWs.send(JSON.stringify({
                type: 'watch-status',
                key,
                isWatched: !!route
            }));
        }

        for (const [ws, sub] of this.relaySourceSubscriptions.entries()) {
            if (sub.keys.has(key) || (route && route.sessionId === sub.sessionId)) {
                this.sendSourceStatusToClient(ws, sub.sessionId, Array.from(sub.keys));
            }
        }
    }

    private sendSourceStatusToClient(ws: WebSocket, sessionId: string, keys: string[]): void {
        if (ws.readyState !== 1) return;

        const statuses: Record<string, boolean> = {};
        for (const key of keys) {
            statuses[key] = this.globalDesktopSources.has(key);
        }

        const sessionActiveKeys: string[] = [];
        const activeNames: Record<string, string> = {};
        const activeSummonerNames: Record<string, string> = {};

        for (const [key, route] of this.desktopRoutes.entries()) {
            if (route.sessionId === sessionId) {
                sessionActiveKeys.push(key);
                activeNames[key] = route.name || key;
                activeSummonerNames[key] = route.summonerName || 'Someone';
                statuses[key] = this.globalDesktopSources.has(key);
            }
        }

        const allRelevantKeys = new Set([...keys, ...sessionActiveKeys]);
        const capturing = Array.from(allRelevantKeys).filter(k => this.capturingKeys.has(k));

        ws.send(JSON.stringify({
            type: PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE,
            payload: {
                statuses,
                activeKeys: sessionActiveKeys,
                capturingKeys: capturing,
                activeNames,
                activeSummonerNames
            }
        }));
    }
}
