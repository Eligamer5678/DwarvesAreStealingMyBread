import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { mergeObjects, pickDefaults } from "../utils/Support.js";

/**
 * DropsComponent
 *
 * When the owning entity is defeated, awards `drops` to the player
 * with a short fly-to-inventory animation (reverse of Hopper transfer).
 *
 * Expected opts:
 * - drops: [[id, amount], ...]
 * - transferSeconds?: number
 */
export default class DropsComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            chunkManager: null,
            target: null, // usually the player
            Draw: null,
        };

        const defaults = {
            drops: [],
            transferSeconds: 0.45,
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));

        this._activated = false;
        this._done = false;
        this._queue = []; // [{id, amount}]
        this._transfer = null; // {id, amount, t, start:Vector, end:Vector}
    }

    /** Called by EntityManager meta pass for per-instance overrides. */
    applyMeta(meta = {}) {
        if (!meta || typeof meta !== "object") return;
        if (Array.isArray(meta.drops)) this.drops = meta.drops;
    }

    clone(entity) {
        const defaults = {
            drops: [],
            transferSeconds: 0.45,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new DropsComponent(entity, data, opts);
        return cloned;
    }

    defeat() {
        if (this._activated) return;
        this._activated = true;
        try { this.entity.noClip = true; } catch (e) {}

        const src = this._getDropSource();
        if (!src || src.length === 0) {
            this._finish();
            return;
        }

        this._queue = [];
        for (const entry of src) {
            if (!entry) continue;
            const id = String(entry[0] ?? "").trim();
            const amt = Math.max(1, Number(entry[1] ?? 1) || 1);
            if (!id) continue;
            this._queue.push({ id, amount: amt });
        }

        if (this._queue.length === 0) this._finish();
    }

    _getDropSource() {
        // Prefer per-instance meta, fall back to opts
        if (this.entity?.meta && Array.isArray(this.entity.meta.drops) && this.entity.meta.drops.length > 0) {
            return this.entity.meta.drops;
        }
        if (Array.isArray(this.drops) && this.drops.length > 0) return this.drops;
        return null;
    }

    _getPlayer() {
        if (this.manager && this.manager.player) return this.manager.player;
        if (this.target) return this.target;
        return null;
    }

    _centerOf(entity) {
        const ex = (entity.pos?.x || 0) + (entity.size?.x ? entity.size.x * 0.5 : 0);
        const ey = (entity.pos?.y || 0) + (entity.size?.y ? entity.size.y * 0.5 : 0);
        return new Vector(ex, ey);
    }

    /** Resolve a block-based tile sprite (tilesheet + tile coord) for an id. */
    _resolveTileSprite(id) {
        const bid = String(id || "");
        if (!bid) return null;

        const cm = this.chunkManager || (this.manager && this.manager.chunkManager) || null;
        if (!cm || !cm.blockDefs) return null;

        let meta = null;
        try {
            if (cm.blockDefs instanceof Map && cm.blockDefs.has(bid)) meta = cm.blockDefs.get(bid);
        } catch (e) {}
        if (!meta || !meta.texture) return null;

        const tex = meta.texture;
        const tilemapName = tex.tilemap;
        if (!tilemapName) return null;

        let sheet = null;
        try {
            const resources = (this.manager && this.manager.spriteImages) || null;
            if (resources && typeof resources.get === "function") sheet = resources.get(tilemapName);
        } catch (e) {}
        if (!sheet) return null;

        let tile = tex.pos || tex.coord || null; // tex.pos is [col,row] from blocks.json
        if (Array.isArray(tile) && tile.length >= 2) {
            tile = [tile[1], tile[0]]; // convert to [row,col] for Draw.tile
        }
        return { sheet, tile };
    }

    update(delta) {
        if (!this._activated || this._done) return;

        const dt = Math.max(0, delta || 0);
        if (!this._transfer) {
            if (!this._queue || this._queue.length === 0) {
                this._finish();
                return;
            }
            const next = this._queue.shift();
            const player = this._getPlayer();
            if (!player || !player.pos) {
                // No player, just grant immediately
                this._grantDrop(next);
                return;
            }
            const start = this._centerOf(this.entity);
            const end = this._centerOf(player);
            this._transfer = { id: next.id, amount: next.amount, t: 0, start, end };
        }

        const tr = this._transfer;
        const dur = Math.max(0.1, Number(this.transferSeconds) || 0.45);
        tr.t += dt / dur;
        if (tr.t >= 1) {
            this._grantDrop(tr);
            this._transfer = null;
        }
    }

    _grantDrop(drop) {
        const player = this._getPlayer();
        const id = drop?.id;
        const amount = Math.max(1, Number(drop?.amount ?? 1) || 1);
        if (!id) return;

        if (player && player.onEdit && typeof player.onEdit.emit === "function") {
            const slotIndex = Number(player.selectedSlot ?? 0) || 0;
            try { player.onEdit.emit(slotIndex, amount, id); } catch (e) {}
            return;
        }

        try {
            const inv = player && player.inventory;
            if (inv && typeof inv.addItem === "function") {
                inv.addItem(id, "inventory", false, "inventory", amount, true);
            }
        } catch (e) {}
    }

    _finish() {
        this._done = true;
        try { this.entity.dead = true; } catch (e) {}
    }

    draw() {
        if (!this._transfer) return;
        const Draw = this.Draw || (this.manager && this.manager.draw) || null;
        if (!Draw) return;

        const tr = this._transfer;
        const t = Math.min(1, Math.max(0, tr.t || 0));
        const cur = tr.start.add(tr.end.sub(tr.start).mult(t));

        const player = this._getPlayer();
        const inv = player && player.inventory;
        let rendered = false;

        try {
            const ts = this._resolveTileSprite(tr.id);
            if (ts && ts.sheet) {
                Draw.tile(ts.sheet, cur, new Vector(8, 8), ts.tile, 0, null, 1, false);
                rendered = true;
            }
        } catch (e) { rendered = false; }

        if (!rendered && inv && typeof inv.getItem === "function") {
            try {
                const resolved = inv.getItem(tr.id);
                if (resolved && resolved.sheet) {
                    Draw.sheet(resolved.sheet, cur, new Vector(8, 8), null, 0, null, 1, false);
                    rendered = true;
                }
            } catch (e) { rendered = false; }
        }

        if (!rendered) {
            try {
                Draw.arc(cur.add(new Vector(4, 4)), new Vector(8, 8), 0, Math.PI * 2, "#ffff00ff", true, false);
            } catch (e) {}
        }
    }
}
