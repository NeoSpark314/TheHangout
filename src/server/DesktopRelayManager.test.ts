import { describe, expect, it, vi } from 'vitest';
import { PACKET_TYPES } from '../shared/constants/Constants';
import { DesktopRelayManager } from './DesktopRelayManager';

function createWs() {
    return {
        readyState: 1,
        send: vi.fn(),
        close: vi.fn()
    } as any;
}

describe('DesktopRelayManager', () => {
    it('subscribes relay clients to source status and replies with current state', () => {
        const sendPacket = vi.fn();
        const sendBinary = vi.fn();
        const manager = new DesktopRelayManager(new Map(), sendPacket, sendBinary);
        const relayWs = createWs();

        const handled = manager.handleRelayConnection(relayWs, 'session-a', 'peer-a', {
            type: PACKET_TYPES.DESKTOP_SOURCES_STATUS_REQUEST,
            payload: { keys: ['screen-1'] }
        });

        expect(handled).toBe(true);
        const response = JSON.parse(relayWs.send.mock.calls[0][0]);
        expect(response.type).toBe(PACKET_TYPES.DESKTOP_SOURCES_STATUS_RESPONSE);
        expect(response.payload.statuses['screen-1']).toBe(false);
    });

    it('reports offline when a summon targets a missing desktop source', () => {
        const sendPacket = vi.fn();
        const sendBinary = vi.fn();
        const manager = new DesktopRelayManager(new Map(), sendPacket, sendBinary);

        manager.handleRelayConnection(createWs(), 'session-a', 'peer-a', {
            type: PACKET_TYPES.DESKTOP_STREAM_SUMMON,
            payload: { key: 'missing-screen', name: 'Workstation' }
        });

        expect(sendPacket).toHaveBeenCalledWith('session-a', PACKET_TYPES.DESKTOP_STREAM_OFFLINE, {
            key: 'missing-screen',
            sessionId: 'session-a'
        });
    });

    it('creates a route for live sources and notifies the session on summon and stop', () => {
        const sendPacket = vi.fn();
        const sendBinary = vi.fn();
        const manager = new DesktopRelayManager(new Map(), sendPacket, sendBinary);
        const sourceWs = createWs();
        const relayWs = createWs();

        manager.handleDesktopSourceMessage(sourceWs, JSON.stringify({
            type: 'register-global-source',
            key: 'screen-1'
        }));
        manager.handleDesktopSourceMessage(sourceWs, JSON.stringify({
            type: 'source-capture-started',
            key: 'screen-1'
        }));

        const handled = manager.handleRelayConnection(relayWs, 'session-a', 'peer-a', {
            type: PACKET_TYPES.DESKTOP_STREAM_SUMMON,
            payload: { key: 'screen-1', name: 'Main Display', summonerName: 'Host' }
        });

        expect(handled).toBe(true);
        expect(sendPacket).toHaveBeenCalledWith('session-a', PACKET_TYPES.DESKTOP_STREAM_SUMMONED, expect.objectContaining({
            key: 'screen-1',
            sessionId: 'session-a',
            summonedByPeerId: 'peer-a'
        }));
        expect(sendPacket).toHaveBeenCalledWith('session-a', PACKET_TYPES.SESSION_NOTIFICATION, expect.objectContaining({
            kind: 'desktop_stream_started',
            subjectName: 'Main Display'
        }));

        manager.handleRelayConnection(relayWs, 'session-a', 'peer-a', {
            type: PACKET_TYPES.DESKTOP_STREAM_STOP,
            payload: { key: 'screen-1' }
        });

        expect(sendPacket).toHaveBeenCalledWith('session-a', PACKET_TYPES.DESKTOP_STREAM_STOPPED, {
            key: 'screen-1',
            sessionId: 'session-a'
        });
    });

    it('routes binary frames only for active captured streams', () => {
        const sendPacket = vi.fn();
        const sendBinary = vi.fn();
        const activeSessions = new Map([
            ['session-a', {
                network: { bytesReceived: 0 },
                context: { runtime: { diagnostics: { recordNetworkReceived: vi.fn() } } }
            }]
        ]);
        const manager = new DesktopRelayManager(activeSessions as any, sendPacket, sendBinary);
        const sourceWs = createWs();

        manager.handleDesktopSourceMessage(sourceWs, JSON.stringify({
            type: 'register-global-source',
            key: 'screen-1'
        }));
        manager.handleDesktopSourceMessage(sourceWs, JSON.stringify({
            type: 'source-capture-started',
            key: 'screen-1'
        }));
        manager.handleRelayConnection(createWs(), 'session-a', 'peer-a', {
            type: PACKET_TYPES.DESKTOP_STREAM_SUMMON,
            payload: { key: 'screen-1', name: 'Desk' }
        });

        const key = Buffer.from('screen-1', 'utf8');
        const frame = Buffer.alloc(2 + key.length + 8 + 3);
        frame.writeUInt8(PACKET_TYPES.DESKTOP_STREAM_FRAME, 0);
        frame.writeUInt8(key.length, 1);
        key.copy(frame, 2);
        frame.writeBigUInt64BE(BigInt(123), 2 + key.length);
        frame.writeUInt8(1, 2 + key.length + 8);

        manager.handleDesktopSourceMessage(sourceWs, frame);

        expect(sendBinary).toHaveBeenCalledWith('session-a', frame);
    });

    it('marks an active route offline when the desktop source disconnects', () => {
        const sendPacket = vi.fn();
        const sendBinary = vi.fn();
        const manager = new DesktopRelayManager(new Map(), sendPacket, sendBinary);
        const sourceWs = createWs();

        manager.handleDesktopSourceMessage(sourceWs, JSON.stringify({
            type: 'register-global-source',
            key: 'screen-1'
        }));
        manager.handleRelayConnection(createWs(), 'session-a', 'peer-a', {
            type: PACKET_TYPES.DESKTOP_STREAM_SUMMON,
            payload: { key: 'screen-1', name: 'Desk' }
        });

        manager.handleDesktopSourceDisconnect(sourceWs);

        expect(sendPacket).toHaveBeenCalledWith('session-a', PACKET_TYPES.DESKTOP_STREAM_OFFLINE, {
            key: 'screen-1',
            sessionId: 'session-a'
        });
    });
});
