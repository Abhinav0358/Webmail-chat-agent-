export class AsyncLocalStorage {
    constructor() {}
    getStore() { return undefined; }
    run(store, callback, ...args) { return callback(...args); }
}
