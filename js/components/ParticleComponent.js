import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { mergeObjects, pickDefaults } from "../utils/Support.js";

/**
 * ParticleComponent
 *
 * Simple square particle burst system for pixel art effects.
 * Attach to entities and call `burst()`.
 */
export default class ParticleComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            Draw: null,
        };

        const defaults = {
            sizeMin: 2,
            sizeMax: 4,
            lifeMin: 0.2,
            lifeMax: 0.5,
            speedMin: 20,
            speedMax: 60,
            spread: Math.PI * 2,
            gravity: 0,
            color: null, // if null, sample from entity spritesheet
            colorJitter: { min: 0.85, max: 1.15 },
            velocity: null, // Vector base velocity
            velocityJitter: 0, // added/subtracted random scalar to velocity components
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));

        this._particles = [];
        this._scratch = null; // offscreen canvas for sampling colors
        this._scratchCtx = null;
    }

    clone(entity) {
        const defaults = {
            sizeMin: 2,
            sizeMax: 4,
            lifeMin: 0.2,
            lifeMax: 0.5,
            speedMin: 20,
            speedMax: 60,
            spread: Math.PI * 2,
            gravity: 0,
            color: null,
            colorJitter: { min: 0.85, max: 1.15 },
            velocity: null,
            velocityJitter: 0,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new ParticleComponent(entity, data, opts);
        return cloned;
    }

    /**
     * Emit a burst of particles.
     * @param {Object} opts
     * @param {number} [opts.count=8]
     * @param {Vector} [opts.pos]
     * @param {string|null} [opts.color]
     * @param {Object} [opts.colorJitter]
     * @param {number} [opts.lifeMin]
     * @param {number} [opts.lifeMax]
     * @param {number} [opts.sizeMin]
     * @param {number} [opts.sizeMax]
     * @param {number} [opts.speedMin]
     * @param {number} [opts.speedMax]
     * @param {number} [opts.spread]
     * @param {number} [opts.gravity]
     * @param {Vector} [opts.velocity]
     * @param {number} [opts.velocityJitter]
     */
    burst(opts = {}) {
        const count = Math.max(1, Number(opts.count ?? 8) || 8);
        const center = opts.pos || this._centerOf(this.entity);
        const color = (opts.color !== undefined) ? opts.color : this.color;
        const colorJitter = (opts.colorJitter !== undefined) ? opts.colorJitter : this.colorJitter;
        const lifeMin = (opts.lifeMin !== undefined) ? opts.lifeMin : this.lifeMin;
        const lifeMax = (opts.lifeMax !== undefined) ? opts.lifeMax : this.lifeMax;
        const sizeMin = (opts.sizeMin !== undefined) ? opts.sizeMin : this.sizeMin;
        const sizeMax = (opts.sizeMax !== undefined) ? opts.sizeMax : this.sizeMax;
        const speedMin = (opts.speedMin !== undefined) ? opts.speedMin : this.speedMin;
        const speedMax = (opts.speedMax !== undefined) ? opts.speedMax : this.speedMax;
        const spread = (opts.spread !== undefined) ? opts.spread : this.spread;
        const gravity = (opts.gravity !== undefined) ? opts.gravity : this.gravity;
        const baseVelocity = (opts.velocity !== undefined) ? opts.velocity : this.velocity;
        const velJitter = (opts.velocityJitter !== undefined) ? opts.velocityJitter : this.velocityJitter;


        for (let i = 0; i < count; i++) {
            const size = this._rand(sizeMin, sizeMax);
            const life = this._rand(lifeMin, lifeMax);
            const ang = Math.random() * (Number(spread) || Math.PI * 2);
            const speed = this._rand(speedMin, speedMax);
            let vel = new Vector(Math.cos(ang) * speed, Math.sin(ang) * speed);
            if (baseVelocity && baseVelocity.x !== undefined && baseVelocity.y !== undefined) {
                vel = vel.add(baseVelocity);
            }
            if (velJitter) {
                const j = Math.max(0, Number(velJitter) || 0);
                vel.x += this._rand(-j, j);
                vel.y += this._rand(-j, j);
            }
            let col = color || this._sampleColorFromSheet() || "#ffffff";
            if (color && colorJitter) col = this._applyColorJitter(col, colorJitter);
            this._particles.push({
                pos: center.clone(),
                vel,
                life,
                ttl: life,
                size,
                color: col,
                gravity: Number(gravity) || 0,
            });
        }
    }

    update(delta) {
        const dt = Math.max(0, delta || 0);
        if (!this._particles.length) return;

        for (let i = this._particles.length - 1; i >= 0; i--) {
            const p = this._particles[i];
            p.life -= dt;
            if (p.life <= 0) {
                this._particles.splice(i, 1);
                continue;
            }
            const g = Number(p.gravity) || 0;
            if (g) p.vel.y += g * dt;
            p.pos.addS(p.vel.mult(dt));
        }
    }

    draw() {
        if (!this._particles.length) return;
        const Draw = this.Draw || (this.manager && this.manager.draw) || null;
        if (!Draw) return;

        for (const p of this._particles) {
            const alpha = Math.max(0, Math.min(1, p.life / (p.ttl || 1)));
            const size = new Vector(p.size, p.size);
            // If color already has alpha, respect it; otherwise multiply by alpha via hex alpha.
            const col = this._applyAlpha(p.color, alpha);
            Draw.rect(p.pos, size, col, true, false);
        }
    }

    _centerOf(entity) {
        const ex = (entity.pos?.x || 0) + (entity.size?.x ? entity.size.x * 0.5 : 0);
        const ey = (entity.pos?.y || 0) + (entity.size?.y ? entity.size.y * 0.5 : 0);
        return new Vector(ex, ey);
    }

    _rand(a, b) {
        const min = Math.min(a, b);
        const max = Math.max(a, b);
        return min + Math.random() * (max - min);
    }

    _applyAlpha(color, a) {
        if (!color) return "#ffffff";
        // If color is already rgba/hsla, just return; Draw converts with alpha anyway.
        if (typeof color === "string" && (color.startsWith("rgba") || color.startsWith("hsla"))) return color;
        // If 8-digit hex, replace alpha
        if (typeof color === "string" && color.startsWith("#") && color.length === 9) {
            const base = color.slice(0, 7);
            const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
            return `${base}${alpha}`;
        }
        // 6-digit hex -> add alpha
        if (typeof color === "string" && color.startsWith("#") && color.length === 7) {
            const alpha = Math.round(Math.max(0, Math.min(1, a)) * 255).toString(16).padStart(2, "0");
            return `${color}${alpha}`;
        }
        return color;
    }

    _applyColorJitter(color, jitter) {
        const min = Math.max(0, Math.min(2, Number(jitter?.min ?? 1) || 1));
        const max = Math.max(min, Math.min(2, Number(jitter?.max ?? 1) || 1));
        const factor = this._rand(min, max);
        if (typeof color !== "string" || !color.startsWith("#") || (color.length !== 7 && color.length !== 9)) return color;
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        const a = (color.length === 9) ? color.slice(7, 9) : "ff";
        const nr = Math.max(0, Math.min(255, Math.round(r * factor))).toString(16).padStart(2, "0");
        const ng = Math.max(0, Math.min(255, Math.round(g * factor))).toString(16).padStart(2, "0");
        const nb = Math.max(0, Math.min(255, Math.round(b * factor))).toString(16).padStart(2, "0");
        return `#${nr}${ng}${nb}${a}`;
    }

    _sampleColorFromSheet() {
        try {
            const sheetComp = this.entity?.getComponent?.("sheet");
            const sheet = sheetComp?.sheet;
            if (!sheet || !sheet.sheet || !sheet.slicePx) return null;

            const img = sheet.sheet; // Image or Canvas
            const slice = sheet.slicePx;
            const anim = sheet.currentAnimation;
            const row = anim ? anim.row : 0;
            const frame = anim ? (sheet.currentFrame || 0) : 0;

            const sx = Math.max(0, frame) * slice;
            const sy = Math.max(0, row) * slice;

            // Build scratch canvas once
            if (!this._scratch) {
                this._scratch = document.createElement("canvas");
                this._scratch.width = img.width || slice;
                this._scratch.height = img.height || slice;
                this._scratchCtx = this._scratch.getContext("2d");
                if (img instanceof HTMLImageElement) this._scratchCtx.drawImage(img, 0, 0);
            }

            const ctx = (img instanceof HTMLCanvasElement) ? img.getContext("2d") : this._scratchCtx;
            if (!ctx) return null;

            // Sample random pixel in frame bounds
            const px = sx + Math.floor(Math.random() * slice);
            const py = sy + Math.floor(Math.random() * slice);
            const data = ctx.getImageData(px, py, 1, 1).data;
            if (data[3] === 0) return null; // transparent
            const r = data[0].toString(16).padStart(2, "0");
            const g = data[1].toString(16).padStart(2, "0");
            const b = data[2].toString(16).padStart(2, "0");
            return `#${r}${g}${b}ff`;
        } catch (e) {
            return null;
        }
    }
}
