import Sprite from '../sprites/Sprite.js';
import Vector from '../Vector.js';
import PathfindComponent from '../components/PathfindComponent.js';

/**
 * Slime entity: lightweight wrapper that uses a PathfindComponent for AI.
 * Constructor signature mirrors the old slime for convenience:
 * new Slime(Draw, pos, size, sheet, options)
 */
export default class Slime extends Sprite {
    constructor(Draw, pos = new Vector(0,0), size = new Vector(24,24), sheet = null, options = {}){
        // call Sprite constructor: (keys, Draw, pos, size, spriteSheet, inputSettings)
        super(null, Draw, pos, size, sheet, null);

        const opts = Object.assign({}, options || {});
        // create and attach pathfinder component (type 'simple')
        this.components = this.components || [];
        const pf = new PathfindComponent(Object.assign({ type: 'simple' }, opts));
        this.components.push(pf);
        // Ensure this sprite has a per-entity connected sheet instance so
        // animation updates don't interfere across entities (avoids double-advance).
        try {
            if (this.sheet && typeof this.sheet.connect === 'function') {
                this.sheet = this.sheet.connect();
            }
        } catch (e) { /* ignore */ }

        // Some entity defaults (match old slime defaults)
        this.speed = opts.speed || pf.speed;
        this.gravity = opts.gravity || pf.gravity;
        this.jumpSpeed = opts.jumpSpeed || pf.jumpSpeed;
        this.mass = opts.mass || 1;
        this.onGround = true;
    }

    // Keep Sprite.update behavior; components are updated by EntityManager
}
