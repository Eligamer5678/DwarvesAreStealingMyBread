import Vector from '../Vector.js';

/**
 * SheetComponent: a lightweight component that manages a SpriteSheet-like
 * instance for an entity. It controls animation playback and provides a
 * simple draw(...) helper that delegates to `Draw.sheet`.
 *
 * Options:
 * - sheetKey: string key to look up in manager.SpriteImages (preferred)
 * - sheet: an already-constructed SpriteSheet instance
 * - animation: initial animation name (default: 'idle')
 * - size: Vector or {x,y} override for draw size
 * - invert: optional invert vector for drawing
 * - opacity: initial opacity
 */
export default class SheetComponent {
    constructor(opts = {}){
        this.sheetKey = opts.sheetKey || opts.key || null;
        this.sheet = opts.sheet || null; // SpriteSheet instance
        this.animation = opts.animation || 'idle';
        this.size = opts.size || null;
        this.invert = opts.invert || null;
        this.opacity = (typeof opts.opacity === 'number') ? opts.opacity : 1;
        this.smoothing = opts.smoothing === undefined ? false : !!opts.smoothing;

        this._entity = null;
        this._manager = null;
        this._connected = null; // per-entity connected sheet view
    }

    init(entity, manager){
        this._entity = entity;
        this._manager = manager;

        // Resolve sheet instance: explicit sheet > manager.SpriteImages lookup
        try {
            if (!this.sheet && manager && manager.SpriteImages && typeof manager.SpriteImages.get === 'function' && this.sheetKey) {
                this.sheet = manager.SpriteImages.get(this.sheetKey) || this.sheet;
            }
        } catch (e) {
            console.warn('SheetComponent: failed to lookup sheet', e);
        }

        // If sheet has a `connect` method (SpriteSheet), call it to get per-entity state
        try {
            if (this.sheet && typeof this.sheet.connect === 'function') {
                this._connected = this.sheet.connect();
                // start playback
                if (this.animation && typeof this._connected.playAnimation === 'function') this._connected.playAnimation(this.animation, true);
            } else {
                // fallback: set connected to the raw sheet so Draw.sheet can operate
                this._connected = this.sheet;
            }
        } catch (e) {
            console.warn('SheetComponent: failed to connect sheet', e);
            this._connected = this.sheet;
        }
    }

    play(name, reset = false){
        this.animation = name;
        if (this._connected && typeof this._connected.playAnimation === 'function') this._connected.playAnimation(name, !!reset);
    }

    update(dt){
        if (this._connected && typeof this._connected.updateAnimation === 'function') {
            try { this._connected.updateAnimation(dt); } catch (e) { /* ignore */ }
        }
    }

    draw(draw, pos, sizeOverride = null){
        if (!this._connected || !draw) return;
        const size = sizeOverride || this.size || (this._entity && this._entity.size) || null;
        const anim = this.animation;
        const frame = (this._connected && typeof this._connected.currentFrame === 'number') ? this._connected.currentFrame : 0;
        try {
            draw.sheet(this._connected, pos, size, anim, frame, this.invert, this.opacity, this.smoothing);
        } catch (e) {
            // fail silently to avoid breaking entity draws
            console.warn('SheetComponent.draw failed', e);
        }
    }

    destroy(){
        // nothing to free for now; if we created per-entity resources, release them here
        this._connected = null;
        this.sheet = null;
        this._entity = null;
        this._manager = null;
    }
}
