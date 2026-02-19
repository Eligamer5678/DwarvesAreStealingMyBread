import Component from "./Component.js";
import Vector from "../modules/Vector.js";
import { mergeObjects, pickDefaults } from "../utils/Support.js";

/**
 * RectColliderComponent
 *
 * Simple rectangular physics body for entities that should be
 * affected by gravity, collide with tiles (via EntityManager),
 * and respond to external impulses on `entity.vlos` (e.g. player attacks).
 */
export default class RectColliderComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            chunkManager: null,
        };

        const defaults = {
            gravity: 5,        // vertical acceleration applied each frame (scaled by dt)
            friction: 0.90,    // horizontal damping each frame
            maxFallSpeed: 30,  // clamp for downward speed (approximate)
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));
    }

    init() {
        // Ensure required fields exist on the entity
        if (!this.entity.vlos) this.entity.vlos = new Vector(0, 0);
    }

    clone(entity) {
        const defaults = {
            gravity: 5,
            friction: 0.90,
            maxFallSpeed: 30,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new RectColliderComponent(entity, data, opts);
        return cloned;
    }

    update(dt) {
        const e = this.entity;
        if (!e) return;
        if (e.health !== undefined && e.health <= 0) return;

        const g = Number(this.gravity) || 0;
        const maxFall = Number(this.maxFallSpeed) || 0;
        const friction = (this.friction !== undefined && this.friction !== null)
            ? Number(this.friction)
            : 0.90;

        // Apply gravity
        e.vlos.y += g * dt;
        if (maxFall > 0 && e.vlos.y > maxFall) e.vlos.y = maxFall;

        // Integrate velocity into position
        if (typeof e.pos?.addS === "function") {
            e.pos.addS(e.vlos);
        } else if (e.pos && typeof e.pos.x === "number" && typeof e.pos.y === "number") {
            e.pos.x += e.vlos.x;
            e.pos.y += e.vlos.y;
        }

        // Simple horizontal friction
        e.vlos.x *= friction;
        if (Math.abs(e.vlos.x) < 0.01) e.vlos.x = 0;

        // If tile collision has marked us as onGround, avoid accumulating
        // downward velocity when resting.
        if (e.onGround && e.vlos.y > 0) e.vlos.y = 0;
    }
}
