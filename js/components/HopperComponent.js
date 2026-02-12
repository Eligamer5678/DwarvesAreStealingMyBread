import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { mergeObjects, pickDefaults } from "../utils/Support.js";

/**
 * HopperComponent
 *
 * Attach to an entity (e.g. a key) to require items before it becomes usable.
 *
 * Behaviour:
 * - Accepts a list of required items as `items: [[id, amount], ...]`.
 * - Renders one orbiting icon per required item around the entity.
 * - When the player is nearby and has a required item in inventory, it
 *   animates a single item flying from the player to one orbit slot and then
 *   removes that item from the inventory and from the required list.
 * - When all required items are satisfied, `isSatisfied()` returns true.
 *
 * Item sources:
 * - Prefab defaults: data/entities.json -> key.components.HopperComponent.opts.items
 * - Per-instance overrides: chunk entity placement JSON may include
 *   `data.items: [[id, amount], ...]` which are read from `entity.meta.items`.
 */
export default class HopperComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            chunkManager: null,
            target: null,   // usually the player
            Draw: null,
        };

        const defaults = {
            // [[itemId, amount]]
            items: [],
            orbitRadius: 16,
            orbitSpeed: 1.5, // radians / second
            range: 48,       // activation range in pixels
            transferSeconds: 0.6,
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));

        /** @type {{id:string, angle:number, consumed:boolean}[]} */
        this._slots = [];
        this._phase = 0;
        this._transfer = null; // {slotIndex, key, id, t, start:Vector, end:Vector}
        this._built = false;
        this._satisfied = false;
    }

    init() {
        this._ensureSlots();
    }

    /** Called by EntityManager meta pass for per-instance overrides. */
    applyMeta(meta = {}) {
        if (!meta || typeof meta !== "object") return;
        if (Array.isArray(meta.items)) this.items = meta.items;
        // Rebuild slots on next tick
        this._built = false;
    }

    clone(entity) {
        const defaults = {
            items: [],
            orbitRadius: 16,
            orbitSpeed: 1.5,
            range: 48,
            transferSeconds: 0.6,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new HopperComponent(entity, data, opts);
        return cloned;
    }

    isSatisfied() {
        this._ensureSlots();
        return this._satisfied;
    }

    _ensureSlots() {
        if (this._built) return;
        this._built = true;
        this._slots = [];

        // Prefer per-instance chunk data first (like scroll contents), then
        // fall back to prefab defaults from entities.json.
        let src = null;
        if (this.entity && this.entity.meta && Array.isArray(this.entity.meta.items) && this.entity.meta.items.length > 0) {
            src = this.entity.meta.items;
        } else if (Array.isArray(this.items) && this.items.length > 0) {
            src = this.items;
        }

        if (!src || src.length === 0) {
            this._satisfied = true;
            return;
        }

        for (const entry of src) {
            if (!entry) continue;
            const id = String(entry[0] ?? "").trim();
            const amt = Math.max(1, Number(entry[1] ?? 1) || 1);
            if (!id) continue;
            for (let i = 0; i < amt; i++) {
                this._slots.push({ id, angle: 0, consumed: false });
            }
        }

        if (this._slots.length === 0) {
            this._satisfied = true;
            return;
        }

        // Spread angles evenly
        const n = this._slots.length;
        const twoPi = Math.PI * 2;
        for (let i = 0; i < n; i++) {
            this._slots[i].angle = (twoPi * i) / n;
        }
        this._satisfied = false;
    }

    _centerOf(entity) {
        const ex = (entity.pos?.x || 0) + (entity.size?.x ? entity.size.x * 0.5 : 0);
        const ey = (entity.pos?.y || 0) + (entity.size?.y ? entity.size.y * 0.5 : 0);
        return new Vector(ex, ey);
    }

    _orbitPos(slot, phase) {
        const center = this._centerOf(this.entity);
        const r = Math.max(4, Number(this.orbitRadius) || 20);
        const a = phase + (slot.angle || 0);
        const ox = Math.cos(a) * r;
        const oy = Math.sin(a) * r;
        // draw centered around a half-size tile-ish icon (8x8)
        return new Vector(center.x + ox - 4, center.y + oy - 4);
    }

    _getPlayer() {
        if (this.manager && this.manager.player) return this.manager.player;
        if (this.target) return this.target;
        return null;
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
        this._ensureSlots();
        if (this._satisfied) return;

        const dt = Math.max(0, delta || 0);
        this._phase += (Number(this.orbitSpeed) || 0) * dt;

        if (this._transfer) {
            this._updateTransfer(dt);
            return;
        }

        this._maybeStartTransfer();
    }

    _maybeStartTransfer() {
        const player = this._getPlayer();
        if (!player || !player.pos || !player.inventory || !player.inventory.Inventory) return;

        // Check range
        const center = this._centerOf(this.entity);
        const pc = this._centerOf(player);
        const dist = Math.hypot(center.x - pc.x, center.y - pc.y);
        const maxR = Math.max(8, Number(this.range) || 48);
        if (dist > maxR) return;

        // Find first unconsumed slot that the player can satisfy
        const inv = player.inventory;
        for (let i = 0; i < this._slots.length; i++) {
            const slot = this._slots[i];
            if (!slot || slot.consumed) continue;
            const hit = this._findInventoryEntry(inv, slot.id);
            if (!hit) continue;

            const start = pc.clone();
            const end = this._orbitPos(slot, this._phase);
            this._transfer = {
                slotIndex: i,
                key: hit.key,
                id: slot.id,
                t: 0,
                start,
                end,
            };

            this._freezePlayerForTransfer();
            return;
        }
    }

    _freezePlayerForTransfer() {
        const player = this._getPlayer();
        if (!player) return;
        const dur = Math.max(0.1, Number(this.transferSeconds) || 0.6);
        try {
            if (typeof player.hopperFreeze === "number") {
                player.hopperFreeze = Math.max(player.hopperFreeze, dur + 0.05);
            }
        } catch (e) {}
    }

    _findInventoryEntry(inv, wantedId) {
        if (!inv || !inv.Inventory) return null;
        const targetId = String(wantedId || "");
        if (!targetId) return null;

        for (const [key, entry] of inv.Inventory.entries()) {
            if (!entry || !entry.data) continue;
            const nm = entry.data.tile || entry.data.id || null;
            if (!nm || nm !== targetId) continue;
            const amt = Number(entry.data.amount ?? 1);
            if (amt <= 0) continue;
            return { key, entry };
        }
        return null;
    }

    _updateTransfer(dt) {
        const tr = this._transfer;
        if (!tr) return;
        const dur = Math.max(0.1, Number(this.transferSeconds) || 0.6);
        tr.t += dt / dur;
        if (tr.t >= 1) {
            this._completeTransfer();
            this._transfer = null;
        }
    }

    _completeTransfer() {
        const tr = this._transfer;
        if (!tr) return;
        const player = this._getPlayer();
        const inv = player && player.inventory;
        if (!inv) return;

        // Consume 1 item from the stored inventory key
        try {
            if (inv.Inventory && inv.Inventory.has(tr.key)) {
                const entry = inv.Inventory.get(tr.key);
                const amt = Number(entry?.data?.amount ?? 1) - 1;
                if (amt <= 0) {
                    // clear slot and delete entry
                    const sp = String(entry.slotPath || "");
                    const parts = sp.split("/");
                    if (parts.length === 2) {
                        const g = parts[0];
                        const idx = parseInt(parts[1], 10);
                        if (Array.isArray(inv.slots[g]) && idx >= 0 && idx < inv.slots[g].length) {
                            inv.slots[g][idx] = "";
                        }
                    }
                    try { inv.Inventory.delete(tr.key); } catch (e) {}
                } else {
                    entry.data.amount = amt;
                }
            }
        } catch (e) {}

        // Mark slot as satisfied
        const idx = tr.slotIndex;
        if (idx >= 0 && idx < this._slots.length) {
            this._slots[idx].consumed = true;
        }

        // If all slots consumed, mark component satisfied
        this._satisfied = this._slots.every(s => !s || s.consumed);
    }

    draw() {
        this._ensureSlots();
        const Draw = this.Draw || (this.manager && this.manager.draw) || null;
        if (!Draw) return;

        const inv = this._getPlayer() && this._getPlayer().inventory;
        const hasSlots = this._slots && this._slots.length > 0;
        if (!hasSlots) return;

        const phase = this._phase;

        // Orbiting placeholders for each remaining requirement
        for (const slot of this._slots) {
            if (!slot || slot.consumed) continue;
            const pos = this._orbitPos(slot, phase);
            // Prefer block-based tiles from ChunkManager so ids like
            // "pizza-dough" or "cheese_pizza (chedder)" use their
            // in-world icon.
            let rendered = false;
            try {
                const ts = this._resolveTileSprite(slot.id);
                if (ts && ts.sheet) {
                    Draw.tile(ts.sheet, pos, new Vector(8, 8), ts.tile, 0, null, 1, false);
                    rendered = true;
                }
            } catch (e) { rendered = false; }

            // Fallback: try inventory item resolution if available
            if (!rendered && inv && typeof inv.getItem === "function") {
                try {
                    const resolved = inv.getItem(slot.id);
                    if (resolved && resolved.sheet) {
                        Draw.sheet(resolved.sheet, pos, new Vector(8, 8), null, 0, null, 1, false);
                        rendered = true;
                    }
                } catch (e) { rendered = false; }
            }

            if (!rendered) {
                // Fallback: simple circle placeholder
                try {
                    Draw.arc(pos.add(new Vector(4, 4)), new Vector(8, 8), 0, Math.PI * 2, "#ffaa00ff", true, false);
                } catch (e) {}
            }
        }

        // Active transfer: draw the flying icon along its lerp path
        const tr = this._transfer;
        if (tr) {
            const t = Math.min(1, Math.max(0, tr.t || 0));
            const cur = tr.start.add(tr.end.sub(tr.start).mult(t));
            let rendered = false;
            try {
                const ts = this._resolveTileSprite(tr.id);
                if (ts && ts.sheet) {
                    Draw.tile(ts.sheet, cur, new Vector(8, 8), ts.tile, 0, null, 1, false);
                    rendered = true;
                }
            } catch (e) { rendered = false; }

            // Fallback to inventory-resolved sprite if needed
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
}
