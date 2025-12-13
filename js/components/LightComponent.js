import Vector from '../modules/Vector.js';
import Component from './Component.js';
import { mergeObjects,pickDefaults } from '../utils/Support.js';

/**
 * LightComponent: when attached to an entity, registers a torch/light
 * with the LightingSystem. It's modular and can be attached to any entity.
 */
export default class LightComponent extends Component{
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            chunkManager:null,
        }
        const defaults = {
            level:15,
            offset: new Vector(0,0),
        }
        super(entity,Dependencies,data)
        const mergedOpts = mergeObjects(opts,defaults)
        Object.assign(this, mergedOpts)

        this._key = null;
    }

    init() {
        const ls = this.manager.lightingSystem;
        const s = this._sampleCoords();
        const key = `${s.sx},${s.sy}`;
        this._key = key;
        ls.torches.set(key, {level: this.level});
        ls._updateTorchCacheAdd(s.sx, s.sy, this.level);
        ls.markDirty();
    }

    _sampleCoords() {
        const em = this.entity;
        const px = em.pos.x + (this.offset.x);
        const py = em.pos.y + (this.offset.y);
        const tileSize = this.manager.noiseTileSize;
        const sx = Math.floor(px / tileSize);
        const sy = Math.floor(py / tileSize);
        return {sx,sy};
    }

    update(dt) {
        const ls = this.manager.lightingSystem;
        const s = this._sampleCoords();
        const key = `${s.sx},${s.sy}`;
        if (key !== this._key) {
            if (this._key && ls.torches.has(this._key)) {
                ls.torches.delete(this._key);
                const parts = this._key.split(',').map(n => parseInt(n,10));
                ls._updateTorchCacheRemove(parts[0], parts[1]);
            }
            // add new
            ls.torches.set(key, { level: this.level });
            ls._updateTorchCacheAdd(s.sx, s.sy, this.level);
            ls.markDirty();
            this._key = key;
        }
    }

    destroy() {
        // Remove torch from lighting system
        if(!this.key) return;
        const ls = this.manager.lightingSystem;
        if (ls.torches.has(this._key)) ls.torches.delete(this._key);
        const parts = this._key.split(',').map(n => parseInt(n,10));
        ls._updateTorchCacheRemove(parts[0], parts[1]);
        ls.markDirty();
    }
    /**
     * Clone this component
     * @param {EntityType} entity The entity to attach the clone onto
     * @returns {LightComponent}
     */
    clone (entity){
        const defaults = {
            level:15,
            offset: new Vector(0,0),
        }
        const opts = pickDefaults(defaults,this)
        const data = pickDefaults(this.Dependencies,this)
        const cloned = new LightComponent(entity,data,opts);
        return cloned;
    }
}
