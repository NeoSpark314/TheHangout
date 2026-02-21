// core/EventBus.js

class EventBus {
    constructor() {
        this.listeners = {};
    }

    /**
     * Subscribe to an event.
     * @param {string} eventName The name of the event.
     * @param {Function} callback The callback function when the event is emitted.
     */
    on(eventName, callback) {
        if (!this.listeners[eventName]) {
            this.listeners[eventName] = [];
        }
        this.listeners[eventName].push(callback);
    }

    /**
     * Unsubscribe from an event.
     * @param {string} eventName The name of the event.
     * @param {Function} callback The callback function to remove.
     */
    off(eventName, callback) {
        if (!this.listeners[eventName]) return;
        this.listeners[eventName] = this.listeners[eventName].filter(
            (listener) => listener !== callback
        );
    }

    /**
     * Emit an event.
     * @param {string} eventName The name of the event.
     * @param {any} data Optional data to pass to the callbacks.
     */
    emit(eventName, data) {
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

// Export a singleton instance
const eventBus = new EventBus();
export default eventBus;
