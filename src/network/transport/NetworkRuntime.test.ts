import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppContext } from '../../app/AppContext';
import { PACKET_TYPES } from '../../shared/constants/Constants';
import { NetworkRuntime } from './NetworkRuntime';

vi.mock('peerjs', () => ({
    default: class PeerMock {},
    DataConnection: class DataConnectionMock {}
}));

vi.mock('./AuthoritativeSessionHost', () => ({
    AuthoritativeSessionHost: class {
        public applySessionConfigUpdate = vi.fn();
        public handleOwnershipRequest = vi.fn();
        public handleOwnershipRelease = vi.fn();
        public handleScenarioActionRequest = vi.fn();
        public handleRttPing = vi.fn();
        public handlePlayerInput = vi.fn();
        public sendWelcomeState = vi.fn();
        public notifyPeerDisconnected = vi.fn();
        public reclaimOwnership = vi.fn();
        public broadcastOwnershipTransfer = vi.fn();
        public update = vi.fn();
    }
}));

vi.mock('./EntityStateUpdateApplier', () => ({
    applyEntityStateUpdates: vi.fn()
}));

function createContext() {
    const context = new AppContext();
    context.setRuntime('diagnostics', {
        record: vi.fn(),
        recordNetworkSent: vi.fn(),
        recordNetworkReceived: vi.fn(),
        recordRoundTripTime: vi.fn(),
        getNetworkMetricsSnapshot: vi.fn(() => ({
            txBps: 0,
            rxBps: 0,
            txTotal: 0,
            rxTotal: 0,
            lastRttMs: 18,
            avgRttMs: 20,
            jitterMs: 2,
            latencySamples: 3
        }))
    } as any);
    context.setRuntime('replication', {
        handleIncomingFeatureEvent: vi.fn(),
        applySnapshotPayload: vi.fn(),
        sendSnapshotToPeer: vi.fn(),
        requestSnapshotFromHost: vi.fn()
    } as any);
    context.setRuntime('session', {
        applySessionConfigUpdate: vi.fn(),
        getActiveScenario: vi.fn(() => ({ id: 'default-hangout' }))
    } as any);
    context.setRuntime('remoteDesktop', {
        handleSourcesStatus: vi.fn(),
        handleStreamSummoned: vi.fn(),
        handleStreamStopped: vi.fn(),
        handleStreamOffline: vi.fn(),
        handleStreamFrame: vi.fn(),
        handleBinaryFrame: vi.fn()
    } as any);
    context.setRuntime('notify', {
        info: vi.fn(),
        warn: vi.fn()
    } as any);
    context.setRuntime('entity', {
        entities: new Map(),
        getEntity: vi.fn(),
        getAuthoritativeStates: vi.fn(() => [])
    } as any);
    context.setRuntime('scenarioActions', {
        handleReplicatedAction: vi.fn(),
        handleActionResult: vi.fn(),
        executeHostRequest: vi.fn()
    } as any);
    return context;
}

describe('NetworkRuntime', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('routes host session config packets through the authoritative host', () => {
        const context = createContext();
        context.isHost = true;
        const runtime = new NetworkRuntime(context);
        context.setRuntime('network', runtime as any);

        (runtime as any).dispatcher.dispatch('guest-1', {
            type: PACKET_TYPES.SESSION_CONFIG_UPDATE,
            payload: { seed: 7 }
        });

        expect((runtime as any).authoritativeHost.applySessionConfigUpdate).toHaveBeenCalledWith({ seed: 7 });
    });

    it('applies guest session config packets through the session runtime', () => {
        const context = createContext();
        context.isHost = false;
        const runtime = new NetworkRuntime(context);
        context.setRuntime('network', runtime as any);

        (runtime as any).dispatcher.dispatch('host-1', {
            type: PACKET_TYPES.SESSION_CONFIG_UPDATE,
            payload: { seed: 11, assignedSpawnIndex: 2 }
        });

        expect(context.runtime.session.applySessionConfigUpdate).toHaveBeenCalledWith({
            seed: 11,
            assignedSpawnIndex: 2
        });
    });

    it('ignores stale ownership transfers and syncs immediately on local grants', () => {
        const context = createContext();
        const runtime = new NetworkRuntime(context);
        context.setRuntime('network', runtime as any);
        const syncSpy = vi.spyOn(runtime, 'syncEntityNow');
        const entity = {
            id: 'cube-1',
            isAuthority: false,
            ownerId: null,
            onNetworkEvent: vi.fn()
        };
        context.localPlayer = { id: 'me' } as any;
        (context.runtime.entity.getEntity as any).mockReturnValue(entity);

        runtime.applyOwnershipTransfer({
            entityId: 'cube-1',
            newOwnerId: 'me',
            seq: 5
        });
        runtime.applyOwnershipTransfer({
            entityId: 'cube-1',
            newOwnerId: 'other',
            seq: 4
        });

        expect(entity.ownerId).toBe('me');
        expect(entity.isAuthority).toBe(true);
        expect(entity.onNetworkEvent).toHaveBeenCalledTimes(1);
        expect(syncSpy).toHaveBeenCalledWith('cube-1', true);
    });

    it('sends latency probes and records RTT on matching pong packets', () => {
        const context = createContext();
        context.isHost = false;
        context.sessionId = 'host-1';
        const runtime = new NetworkRuntime(context);
        context.setRuntime('network', runtime as any);
        const send = vi.fn();
        runtime.connections.set('host-1', {
            open: true,
            send
        } as any);
        const nowSpy = vi.spyOn(performance, 'now');
        nowSpy.mockReturnValueOnce(1000);

        runtime.update(2.1);

        expect(send).toHaveBeenCalledTimes(1);
        const pingEnvelope = JSON.parse(send.mock.calls[0][0]);
        expect(pingEnvelope.type).toBe(PACKET_TYPES.RTT_PING);

        nowSpy.mockReturnValueOnce(1035);
        (runtime as any).handleRttPong({
            probeId: pingEnvelope.payload.probeId,
            clientSentAt: pingEnvelope.payload.clientSentAt,
            serverReceivedAt: 1005,
            serverSentAt: 1010
        });

        expect(context.runtime.diagnostics.recordRoundTripTime).toHaveBeenCalledTimes(1);
    });
});
