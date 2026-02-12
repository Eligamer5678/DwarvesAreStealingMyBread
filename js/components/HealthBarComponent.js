import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { mergeObjects, pickDefaults } from "../utils/Support.js";

/**
 * HealthBarComponent
 * Draws a simple bar under an entity. Hidden when full health.
 */
export default class HealthBarComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            Draw: null,
        };

        const defaults = {
            width: null, // if null, use entity size.x
            height: 3,
            offset: new Vector(0, 2), // offset below entity bottom
            bgColor: "#000000aa",
            fgColor: "#ff3b3bff",
            hideWhenFull: true,
            minFillWidth: 1,
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));

        this._maxHealth = null;
    }

    init() {
        this._syncMaxHealth(true);
    }

    clone(entity) {
        const defaults = {
            width: null,
            height: 3,
            offset: new Vector(0, 2),
            bgColor: "#000000aa",
            fgColor: "#ff3b3bff",
            hideWhenFull: true,
            minFillWidth: 1,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new HealthBarComponent(entity, data, opts);
        return cloned;
    }

    update() {
        this._syncMaxHealth(false);
    }

    draw() {
        const Draw = this.Draw || (this.manager && this.manager.draw) || null;
        if (!Draw || !this.entity) return;

        const max = Math.max(1, Number(this.entity?.maxHealth ?? this._maxHealth) || 1);
        const cur = Math.max(0, Number(this.entity.health ?? 0) || 0);
        if (this.hideWhenFull && cur >= max) return;

        const w = (this.width !== null && this.width !== undefined) ? Number(this.width) || 0 : (this.entity.size?.x || 0);
        const h = Math.max(1, Number(this.height) || 1);
        if (w <= 0) return;

        const x = (this.entity.pos?.x || 0) + ((this.entity.size?.x || 0) - w) * 0.5;
        const y = (this.entity.pos?.y || 0) + (this.entity.size?.y || 0) + (this.offset?.y || 0);
        const pos = new Vector(x + (this.offset?.x || 0), y);

        const frac = Math.max(0, Math.min(1, cur / max));
        let fillW = w * frac;
        if (cur > 0) {
            const minW = Math.max(0, Number(this.minFillWidth) || 0);
            if (fillW < minW) fillW = Math.min(w, minW);
        }
        Draw.rect(pos, new Vector(w, h), this.bgColor, true, false);
        Draw.rect(pos, new Vector(fillW, h), this.fgColor, true, false);
    }

    _syncMaxHealth(force = false) {
        if (!this.entity) return;
        if (Number(this.entity?.maxHealth ?? 0) > 0 && !force) {
            this._maxHealth = Number(this.entity.maxHealth);
            return;
        }
        const metaHealth = Number(this.entity?.meta?.health ?? 0) || 0;
        if (metaHealth > 0) {
            if (this._maxHealth === null || this._maxHealth > metaHealth) this._maxHealth = metaHealth;
            if (!this.entity.maxHealth || this.entity.maxHealth < this._maxHealth) this.entity.maxHealth = this._maxHealth;
            return;
        }
        const cur = Number(this.entity?.health ?? 0) || 0;
        if (this._maxHealth === null || force) this._maxHealth = cur;
        if (cur > this._maxHealth) this._maxHealth = cur;
        if (!this.entity.maxHealth || this.entity.maxHealth < this._maxHealth) this.entity.maxHealth = this._maxHealth;
    }
}
