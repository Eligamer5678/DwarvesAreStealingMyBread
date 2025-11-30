import Vector from '../Vector.js';

/**
 * LightComponent: when attached to an entity, registers a torch/light
 * with the LightingSystem. It's modular and can be attached to any entity.
 */
export default class LightComponent {
    constructor(opts = {}) {
        this.level = Number.isFinite(opts.level) ? opts.level : 8;
        this.offset = opts.offset ? opts.offset : new Vector(0,0); // offset from entity pos
        this._key = null;
        this._entity = null;
        this._manager = null;
    }

    init(entity, manager) {
        this._entity = entity;
        this._manager = manager;
        // If LightingSystem available, register torch
        try {
            if (manager && manager.lightingSystem) {
                const ls = manager.lightingSystem;
                const s = this._sampleCoords();
                const key = `${s.sx},${s.sy}`;
                this._key = key;
                ls.torches.set(key, { level: this.level });
                if (typeof ls._updateTorchCacheAdd === 'function') ls._updateTorchCacheAdd(s.sx, s.sy, this.level);
                if (typeof ls.markDirty === 'function') ls.markDirty();
            }
        } catch (e) {
            console.warn('LightComponent.init failed', e);
        }
    }

    _sampleCoords() {
        // compute tile sample coordinates from entity pos + offset
        const em = this._entity;
        const px = (em.pos && em.pos.x) ? em.pos.x + (this.offset.x || 0) : 0;
        const py = (em.pos && em.pos.y) ? em.pos.y + (this.offset.y || 0) : 0;
        const tileSize = (this._manager && this._manager.noiseTileSize) ? this._manager.noiseTileSize : 16;
        const sx = Math.floor(px / tileSize);
        const sy = Math.floor(py / tileSize);
        return { sx, sy };
    }

    update(dt) {
        // If entity moves, update torch registration
        if (!this._entity || !this._manager || !this._manager.lightingSystem) return;
        try {
            const ls = this._manager.lightingSystem;
            const s = this._sampleCoords();
            const key = `${s.sx},${s.sy}`;
            if (key !== this._key) {
                // remove old
                if (this._key && ls.torches.has(this._key)) {
                    ls.torches.delete(this._key);
                    if (typeof ls._updateTorchCacheRemove === 'function') {
                        const parts = this._key.split(',').map(n => parseInt(n,10));
                        ls._updateTorchCacheRemove(parts[0], parts[1]);
                    }
                }
                // add new
                ls.torches.set(key, { level: this.level });
                if (typeof ls._updateTorchCacheAdd === 'function') ls._updateTorchCacheAdd(s.sx, s.sy, this.level);
                if (typeof ls.markDirty === 'function') ls.markDirty();
                this._key = key;
            }
        } catch (e) {
            console.warn('LightComponent.update failed', e);
        }
    }

    destroy() {
        // Remove torch from lighting system
        try {
            if (this._manager && this._manager.lightingSystem && this._key) {
                const ls = this._manager.lightingSystem;
                if (ls.torches.has(this._key)) ls.torches.delete(this._key);
                if (typeof ls._updateTorchCacheRemove === 'function') {
                    const parts = this._key.split(',').map(n => parseInt(n,10));
                    ls._updateTorchCacheRemove(parts[0], parts[1]);
                }
                if (typeof ls.markDirty === 'function') ls.markDirty();
            }
        } catch (e) { /* ignore */ }
    }
}
