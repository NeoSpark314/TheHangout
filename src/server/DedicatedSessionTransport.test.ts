import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../app/AppContext';
import { PACKET_TYPES } from '../shared/constants/Constants';
import { EntityType } from '../shared/contracts/IEntityState';
import { DedicatedSessionTransport } from './DedicatedSessionTransport';

const hostInstances: any[] = [];

vi.mock('../network/transport/AuthoritativeSessionHost', () => ({
    AuthoritativeSessionHost: class {
        public registerHandlers = vi.fn();
        public update = vi.fn();
        public sendWelcomeState = vi.fn();
        public notifyPeerJoined = vi.fn();
        public reclaimOwnership = vi.fn();
        public notifyPeerDisconnected = vi.fn();
        public applySessionConfigUpdate = vi.fn();
        constructor() {
            hostInstances.push(this);
        }
    }
}));

function createContext(): AppContext {
    const context = new AppContext();
    context.setRuntime('diagnostics', {
        record: vi.fn(),
        recordNetworkSent: vi.fn(),
        recordNetworkReceived: vi.fn()
    } as any);
    context.setRuntime('entity', {
        removeEntity: vi.fn(),
        getEntity: vi.fn(() => null)
    } as any);
    return context;
}

function createSocket() {
    return {
        readyState: 1,
        send: vi.fn()
    };
}

describe('DedicatedSessionTransport', () => {
    beforeEach(() => {
        hostInstances.length = 0;
        vi.clearAllMocks();
    });

    it('adds clients, sends welcome state, and exposes peer stats', () => {
        const transport = new DedicatedSessionTransport();
        const context = createContext();
        const ws = createSocket();

        transport.setContext(context);
        transport.addClient('peer-a', ws);

        expect(hostInstances[0].registerHandlers).toHaveBeenCalled();
        expect(hostInstances[0].sendWelcomeState).toHaveBeenCalledWith('peer-a', 1);
        expect(hostInstances[0].notifyPeerJoined).toHaveBeenCalledWith('peer-a');
        expect(transport.getPeerAdminStats('peer-a')).toMatchObject({
            bytesIn: 0,
            bytesOut: 0,
            latency: null
        });
    });

    it('removes clients and triggers authoritative cleanup', () => {
        const transport = new DedicatedSessionTransport();
        const context = createContext();
        const ws = createSocket();

        transport.setContext(context);
        transport.addClient('peer-a', ws);
        transport.removeClient('peer-a');

        expect(hostInstances[0].reclaimOwnership).toHaveBeenCalledWith('peer-a');
        expect(context.runtime.entity.removeEntity).toHaveBeenCalledWith('peer-a');
        expect(hostInstances[0].notifyPeerDisconnected).toHaveBeenCalledWith('peer-a');
        expect(transport.getPeerAdminStats('peer-a')).toBeNull();
    });

    it('relays audio packets without going through the dispatcher', () => {
        const transport = new DedicatedSessionTransport();
        const context = createContext();
        const ws = createSocket();

        transport.setContext(context);
        transport.addClient('peer-a', ws);
        const relaySpy = vi.spyOn(transport, 'relayToOthers');
        const dispatchSpy = vi.spyOn((transport as any).dispatcher, 'dispatch');

        transport.handleMessage('peer-a', {
            type: PACKET_TYPES.AUDIO_CHUNK,
            payload: { chunk: 'abc', isHeader: false }
        });

        expect(relaySpy).toHaveBeenCalledWith('peer-a', PACKET_TYPES.AUDIO_CHUNK, { chunk: 'abc', isHeader: false });
        expect(dispatchSpy).not.toHaveBeenCalled();
    });

    it('tracks bytes and diagnostics for send, broadcast, and relay', () => {
        const transport = new DedicatedSessionTransport();
        const context = createContext();
        const wsA = createSocket();
        const wsB = createSocket();

        transport.setContext(context);
        transport.addClient('peer-a', wsA);
        transport.addClient('peer-b', wsB);

        transport.sendData('peer-a', PACKET_TYPES.PEER_DISCONNECT, { peerId: 'x' });
        transport.broadcast(PACKET_TYPES.SESSION_NOTIFICATION, { kind: 'system' });
        transport.relayToOthers('peer-a', PACKET_TYPES.PEER_JOINED, { peerId: 'peer-c' });

        expect(wsA.send).toHaveBeenCalled();
        expect(wsB.send).toHaveBeenCalled();
        expect(transport.bytesSent).toBeGreaterThan(0);
        expect(context.runtime.diagnostics.recordNetworkSent).toHaveBeenCalled();

        const statsA = transport.getPeerAdminStats('peer-a');
        const statsB = transport.getPeerAdminStats('peer-b');
        expect(statsA?.bytesOut).toBeGreaterThan(0);
        expect(statsB?.bytesOut).toBeGreaterThan(0);
    });

    it('updates peer latency stats and can broadcast notifications', () => {
        const transport = new DedicatedSessionTransport();
        const context = createContext();
        const ws = createSocket();

        transport.setContext(context);
        transport.addClient('peer-a', ws);
        transport.handlePeerLatencyReport('peer-a', {
            lastRttMs: 24,
            avgRttMs: 22,
            jitterMs: 3,
            samples: 4,
            reportedAt: 1000
        });
        transport.broadcastNotification('Server maintenance');

        expect(transport.getPeerAdminStats('peer-a')?.latency).toMatchObject({
            lastRttMs: 24,
            avgRttMs: 22
        });
        const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1];
        expect(lastCall).toBeTruthy();
        const notificationEnvelope = JSON.parse(lastCall[0]);
        expect(notificationEnvelope.type).toBe(PACKET_TYPES.SESSION_NOTIFICATION);
        expect(notificationEnvelope.payload.message).toBe('Server maintenance');
    });

    it('syncs a single entity immediately through the dedicated transport API', () => {
        const transport = new DedicatedSessionTransport();
        const context = createContext();
        const ws = createSocket();
        const getNetworkState = vi.fn(() => ({
            id: 'prop-a',
            type: EntityType.PHYSICS_PROP,
            p: [0, 1, 2],
            q: [0, 0, 0, 1],
            v: [0, 0, 0],
            b: null,
            ownerId: null
        }));
        (context.runtime.entity.getEntity as any).mockReturnValue({
            id: 'prop-a',
            type: EntityType.PHYSICS_PROP,
            isDestroyed: false,
            getNetworkState
        });

        transport.setContext(context);
        transport.addClient('peer-a', ws);
        transport.syncEntityNow('prop-a', true);

        expect(getNetworkState).toHaveBeenCalledWith(true);
        const lastCall = ws.send.mock.calls[ws.send.mock.calls.length - 1];
        const envelope = JSON.parse(lastCall[0]);
        expect(envelope.type).toBe(PACKET_TYPES.STATE_UPDATE);
        expect(envelope.payload[0]).toMatchObject({
            id: 'prop-a',
            type: EntityType.PHYSICS_PROP,
            scenarioEpoch: context.sessionConfig.scenarioEpoch
        });
    });
});
