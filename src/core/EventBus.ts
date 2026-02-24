type Callback = (data?: any) => void;

class EventBus {
    private listeners: Record<string, Callback[]> = {};

    constructor() {}

    /**
     * Subscribe to an event.
     * @param eventName The name of the event.
     * @param callback The callback function when the event is emitted.
     */
    public on(eventName: string, callback: Callback): void {
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
    public off(eventName: string, callback: Callback): void {
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
    public emit(eventName: string, data?: any): void {
        if (!this.listeners[eventName]) return;
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
