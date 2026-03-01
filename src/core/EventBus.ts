import type { AppEventMap } from './AppEventMap';

type EventName = keyof AppEventMap;
type TypedCallback<T> = [T] extends [void] ? () => void : (data: T) => void;
type AnyCallback = (data?: unknown) => void;

class EventBus {
    private listeners: Record<string, AnyCallback[]> = {};

    constructor() {}

    /**
     * Subscribe to an event.
     * @param eventName The name of the event.
     * @param callback The callback function when the event is emitted.
     */
    public on<K extends EventName>(eventName: K, callback: TypedCallback<AppEventMap[K]>): void;
    public on(eventName: string, callback: AnyCallback): void;
    public on(eventName: string, callback: AnyCallback): void {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(callback);
    }

    /**
     * Unsubscribe from an event.
     * @param eventName The name of the event.
     * @param callback The callback function to remove.
     */
    public off<K extends EventName>(eventName: K, callback: TypedCallback<AppEventMap[K]>): void;
    public off(eventName: string, callback: AnyCallback): void;
    public off(eventName: string, callback: AnyCallback): void {
        if (!this.listeners[eventName]) return;
        this.listeners[eventName] = this.listeners[eventName].filter(
            (listener) => listener !== callback
        );
    }

    /**
     * Emit an event.
     * @param eventName The name of the event.
     * @param data Optional data to pass to the callbacks.
     */
    public emit<K extends EventName>(
        eventName: K,
        ...args: [AppEventMap[K]] extends [void] ? [] : [data: AppEventMap[K]]
    ): void;
    public emit(eventName: string, data?: unknown): void;
    public emit(eventName: string, ...args: [] | [unknown]): void {
        if (!this.listeners[eventName]) return;
        const [data] = args;
        this.listeners[eventName].forEach((callback) => {
            try {
                callback(data);
            } catch (e) {
                console.error(`Error in event listener for ${eventName}:`, e);
            }
        });
    }
}

const eventBus = new EventBus();
export default eventBus;
