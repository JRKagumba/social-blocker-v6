/**
 * In-memory test substitute for electron-store. Supports dot-path get/set/has/delete and
 * a `.store` getter that returns the full object — matching the API DataManager uses.
 */
class MemStore {
    constructor() { this._d = {}; }

    _splitKey(k) { return String(k).split('.'); }

    get store() { return this._d; }

    has(k) {
        const parts = this._splitKey(k);
        let cur = this._d;
        for (const p of parts) {
            if (cur === null || cur === undefined || !Object.prototype.hasOwnProperty.call(cur, p)) return false;
            cur = cur[p];
        }
        return true;
    }

    get(k, def) {
        const parts = this._splitKey(k);
        let cur = this._d;
        for (const p of parts) {
            if (cur === null || cur === undefined || !Object.prototype.hasOwnProperty.call(cur, p)) return def;
            cur = cur[p];
        }
        return cur === undefined ? def : cur;
    }

    set(k, v) {
        if (typeof k === 'object' && k !== null) {
            for (const key of Object.keys(k)) this.set(key, k[key]);
            return;
        }
        const parts = this._splitKey(k);
        let cur = this._d;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {};
            cur = cur[p];
        }
        cur[parts[parts.length - 1]] = v;
    }

    delete(k) {
        const parts = this._splitKey(k);
        let cur = this._d;
        for (let i = 0; i < parts.length - 1; i++) {
            const p = parts[i];
            if (typeof cur[p] !== 'object' || cur[p] === null) return;
            cur = cur[p];
        }
        delete cur[parts[parts.length - 1]];
    }
}

module.exports = MemStore;
