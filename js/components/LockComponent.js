import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { pickDefaults, mergeObjects } from "../utils/Support.js";

/**
 * Lock & Key gameplay component.
 *
 * Expected opts (works with your current entities.json):
 * - thisId: string (unique instance id)
 * - keyId: string (the key id that unlocks)
 * - lockId: string (the lock id that will be unlocked)
 * - followSpeed?: number (px/s)
 * - insertSpeed?: number (px/s)
 * - followOffset?: {x:number,y:number} (px)
 * - lockRadius?: number (px)
 */
export default class LockComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            // Provided by PrefabLoader / sceneData
            chunkManager: null,
        };
        super(entity, Dependencies, data);

        const defaults = {
            thisId: "",
            keyId: "",
            lockId: "",
            followSpeed: 140,
            insertSpeed: 50,
            followOffset: new Vector(0, -18),
            lockRadius: 30,
            chainStepSeconds: 1/8,
        };

        const merged = mergeObjects(opts, defaults);
        Object.assign(this, merged);

        this._maxHealth = null;
        this._activated = false;
        this._state = "idle"; // idle | follow | insert | unlocked
        this._unlockHooked = false;

        // Animated chain-reaction state (lock-side)
        this._chainActive = false;
        this._chainTimer = 0;
        this._chainIndex = 0;
        this._chainLayers = null; // Array<Array<{sx:number,sy:number,layer:string}>>
        this._chainLockEntity = null;
    }

    init() {
        // Called by EntityManager.addEntity() on the spawned clone.
        if (this._maxHealth === null) this._maxHealth = this.entity.health;
    }

    clone(entity) {
        const defaults = {
            thisId: "",
            keyId: "",
            lockId: "",
            followSpeed: 140,
            insertSpeed: 240,
            followOffset: new Vector(0, -18),
            lockRadius: 14,
            chainStepSeconds: 0.3,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new LockComponent(entity, data, opts);
        return cloned;
    }

    update(delta) {
        if (!this.manager) return;

        const role = this._getRole();
        if (role === "key") this._updateKey(delta);
        else if (role === "lock") this._updateLock(delta);
    }

    _getRole() {
        // If thisId matches the keyId, this entity is the key.
        // If thisId matches the lockId, this entity is the lock.
        if (this.thisId && this.keyId && this.thisId === this.keyId) return "key";
        if (this.thisId && this.lockId && this.thisId === this.lockId) return "lock";
        // fallback: infer by component name used in entities.json
        return "unknown";
    }

    _centerOf(entity) {
        const ex = (entity.pos?.x || 0) + (entity.size?.x ? entity.size.x * 0.5 : 0);
        const ey = (entity.pos?.y || 0) + (entity.size?.y ? entity.size.y * 0.5 : 0);
        return new Vector(ex, ey);
    }

    _moveToward(targetPos, speedPxPerSec, delta) {
        const pos = this.entity.pos;
        const to = targetPos.sub(pos);
        const dist = Math.hypot(to.x, to.y);
        if (dist < 0.001) return true;
        const maxStep = Math.max(0, speedPxPerSec) * Math.max(0, delta);
        if (dist <= maxStep) {
            this.entity.pos = targetPos.clone();
            try { this.entity.vlos.x = 0; this.entity.vlos.y = 0; } catch (e) {}
            return true;
        }
        const dir = to.div(dist);
        const step = dir.mult(maxStep);
        this.entity.pos = pos.add(step);
        try { this.entity.vlos.x = 0; this.entity.vlos.y = 0; } catch (e) {}
        return false;
    }

    _updateKey(delta) {
        const player = this.manager.player;
        if (!player || !player.pos) return;

        // Auto-pickup: start following when player gets close (same radius as locks).
        if (!this._activated) {
            const a = this._centerOf(this.entity);
            const b = this._centerOf(player);
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > Math.max(2, Number(this.lockRadius) || 14)) return;

            this._activated = true;
            this._state = "follow";
            // Ensure the key anim is visible if present
            try {
                const sheetComp = this.entity.getComponent("sheet");
                if (sheetComp?.sheet?.playAnimation) sheetComp.sheet.playAnimation("key", true);
            } catch (e) {}
        }

        // If we are inserting, move directly to the lock and finalize.
        if (this._state === "insert") {
            const lockEnt = this._findTargetLock();
            if (!lockEnt) {
                // lock missing; go back to following
                this._state = "follow";
                return;
            }
            const lockCenter = this._centerOf(lockEnt);
            const targetPos = lockCenter.sub(this.entity.size.mult(0.5));
            const reached = this._moveToward(targetPos, this.insertSpeed, delta);
            if (reached) {
                const lockComp = lockEnt.getComponent("LockComponent") || lockEnt.getComponent("lock") || null;
                if (lockComp && typeof lockComp.unlock === "function") {
                    try { lockComp.unlock(); } catch (e) {}
                } else {
                    // attempt to unlock anyway (play anim, remove blocks)
                    try { this._unlockLockEntity(lockEnt); } catch (e) {}
                }
                // remove key immediately
                try { this.manager.removeEntity(this.entity); } catch (e) { this.entity.dead = true; }
            }
            return;
        }

        // Follow player
        const playerCenter = this._centerOf(player);
        const off = (this.followOffset instanceof Vector) ? this.followOffset : new Vector(0, -18);
        const target = playerCenter.add(off).sub(this.entity.size.mult(0.5));
        this._moveToward(target, this.followSpeed, delta);

        // If close enough to matching lock, transition to insert.
        const lockEnt = this._findTargetLock();
        if (!lockEnt) return;
        const a = this._centerOf(this.entity);
        const b = this._centerOf(lockEnt);
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d <= Math.max(2, Number(this.lockRadius) || 14)) {
            this._state = "insert";
        }
    }

    _updateLock(_delta) {
        this._tickChain(_delta);
    }

    _findTargetLock() {
        const ents = this.manager.entities || [];
        for (const e of ents) {
            if (!e || e === this.entity) continue;
            // Only consider entities that have a LockComponent
            const lc = e.getComponent?.("LockComponent") || e.getComponent?.("lock") || null;
            if (!lc) continue;
            if (typeof lc._getRole === "function" && lc._getRole() !== "lock") continue;
            // Match ids: this key's lockId must equal the lock entity's thisId
            if (lc.thisId && this.lockId && lc.thisId === this.lockId) return e;
        }
        return null;
    }

    unlock() {
        if (this._state === "unlocked") return;
        this._state = "unlocked";
        this._unlockLockEntity(this.entity);
    }

    _unlockLockEntity(lockEntity) {
        if (!lockEntity) return;

        const markUsed = () => {
            try {
                const saver = this.manager?.chunkManager?.saver;
                if (!saver || typeof saver.markLockUsed !== 'function') return;
                const lockKey = this.lockId || this.thisId || null;
                if (lockKey) saver.markLockUsed(lockKey, true);
            } catch (e) {}
        };

        // Play unlock animation and, on stop, remove locked blocks then the lock.
        try {
            const sheetComp = lockEntity.getComponent?.("sheet") || null;
            const sheet = sheetComp?.sheet;
            if (sheet?.playAnimation) {
                sheet.playAnimation("unlock", true);
                if (!this._unlockHooked && sheet.onStop?.connect) {
                    this._unlockHooked = true;
                    sheet.onStop.connect(() => {
                        markUsed();
                        // After unlock animation, start the animated chain reaction.
                        try { this._startLockedBlockChain(lockEntity); } catch (e) {
                            // fallback: clear immediately
                            try { this._removeConnectedLockedBlocks(lockEntity); } catch (e2) {}
                            try { this.manager.removeEntity(lockEntity); } catch (e3) { lockEntity.dead = true; }
                        }
                    });
                }
                return;
            }
        } catch (e) {}

        // Fallback: no animation available; still animate chain reaction.
        markUsed();
        try { this._startLockedBlockChain(lockEntity); } catch (e) {
            try { this._removeConnectedLockedBlocks(lockEntity); } catch (e2) {}
            try { this.manager.removeEntity(lockEntity); } catch (e3) { lockEntity.dead = true; }
        }
    }

    _tickChain(delta) {
        if (!this._chainActive) return;
        if (!this.manager || !this._chainLockEntity) { this._chainActive = false; return; }

        const step = Math.max(0.05, Number(this.chainStepSeconds) || 0.3);
        this._chainTimer += Math.max(0, delta || 0);

        while (this._chainTimer >= step) {
            this._chainTimer -= step;
            const layers = this._chainLayers;
            if (!layers || !Array.isArray(layers) || this._chainIndex >= layers.length) {
                // done
                this._chainActive = false;
                const lockEntity = this._chainLockEntity;
                this._chainLockEntity = null;
                this._chainLayers = null;
                this._chainIndex = 0;
                try { this.manager.removeEntity(lockEntity); } catch (e) { lockEntity.dead = true; }
                break;
            }

            const batch = layers[this._chainIndex] || [];
            this._chainIndex += 1;
            try { this._removeLockedBatch(batch); } catch (e) {}

            try {
                const lighting = this.manager.player?.scene?.lighting;
                if (lighting?.markDirty) lighting.markDirty();
            } catch (e) {}
        }
    }

    _removeLockedBatch(batch) {
        const cm = this.manager.chunkManager;
        if (!cm || typeof cm.getTileValue !== "function" || typeof cm.setTileValue !== "function") return;
        if (!Array.isArray(batch) || batch.length === 0) return;

        for (const cell of batch) {
            if (!cell) continue;
            const sx = Number(cell.sx);
            const sy = Number(cell.sy);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const t = cm.getTileValue(sx, sy, "any");
            if (!t || t.id !== "locked") continue;
            const layer = t.layer || cell.layer || "base";
            cm.setTileValue(sx, sy, null, layer);
        }
    }

    _startLockedBlockChain(lockEntity) {
        const layers = this._planLockedBlockChain(lockEntity);
        // If nothing to remove, just despawn lock immediately.
        if (!layers || !Array.isArray(layers) || layers.length === 0) {
            try { this.manager.removeEntity(lockEntity); } catch (e) { lockEntity.dead = true; }
            return;
        }
        this._chainActive = true;
        this._chainTimer = 0;
        this._chainIndex = 0;
        this._chainLayers = layers;
        this._chainLockEntity = lockEntity;
    }

    _planLockedBlockChain(lockEntity) {
        const cm = this.manager?.chunkManager;
        if (!cm || typeof cm.getTileValue !== "function") return null;

        const ts = this.manager.noiseTileSize || cm.noiseTileSize || 16;
        const c = this._centerOf(lockEntity);
        const sx0 = Math.floor(c.x / ts);
        const sy0 = Math.floor(c.y / ts);

        const seen = new Set();
        const q = [];
        const layersMap = new Map(); // dist -> Array<{sx,sy,layer}>

        const pushIfLocked = (sx, sy, dist) => {
            const k = `${sx},${sy}`;
            if (seen.has(k)) return;
            seen.add(k);
            const t = cm.getTileValue(sx, sy, "any");
            if (!t || t.id !== 'locked') return;
            const layer = t.layer || 'base';
            if (!layersMap.has(dist)) layersMap.set(dist, []);
            layersMap.get(dist).push({ sx, sy, layer });
            q.push([sx, sy, dist]);
        };

        // Seed with 4-neighbors adjacent to the lock (distance 0 step)
        pushIfLocked(sx0 + 1, sy0, 0);
        pushIfLocked(sx0 - 1, sy0, 0);
        pushIfLocked(sx0, sy0 + 1, 0);
        pushIfLocked(sx0, sy0 - 1, 0);

        // BFS through connected locked blocks, layer-by-layer
        while (q.length > 0) {
            const [sx, sy, dist] = q.shift();
            const nd = dist + 1;
            pushIfLocked(sx + 1, sy, nd);
            pushIfLocked(sx - 1, sy, nd);
            pushIfLocked(sx, sy + 1, nd);
            pushIfLocked(sx, sy - 1, nd);
        }

        const dists = Array.from(layersMap.keys()).sort((a, b) => a - b);
        return dists.map(d => layersMap.get(d)).filter(arr => Array.isArray(arr) && arr.length > 0);
    }

    _removeConnectedLockedBlocks(lockEntity) {
        const cm = this.manager.chunkManager;
        if (!cm || typeof cm.getTileValue !== "function" || typeof cm.setTileValue !== "function") return;

        const ts = this.manager.noiseTileSize || cm.noiseTileSize || 16;
        const c = this._centerOf(lockEntity);
        const sx0 = Math.floor(c.x / ts);
        const sy0 = Math.floor(c.y / ts);

        const key = (x, y) => `${x},${y}`;
        const q = [];
        const seen = new Set();

        // Seed with 4-neighbors adjacent to the lock
        q.push([sx0 + 1, sy0]);
        q.push([sx0 - 1, sy0]);
        q.push([sx0, sy0 + 1]);
        q.push([sx0, sy0 - 1]);

        const tryRemoveLockedAt = (sx, sy) => {
            const t = cm.getTileValue(sx, sy, "any");
            if (!t || t.id !== "locked") return false;
            const layer = t.layer || "base";
            cm.setTileValue(sx, sy, null, layer);
            return true;
        };

        while (q.length > 0) {
            const [sx, sy] = q.shift();
            const k = key(sx, sy);
            if (seen.has(k)) continue;
            seen.add(k);

            if (!tryRemoveLockedAt(sx, sy)) continue;

            // chain reaction through adjacent locked blocks
            q.push([sx + 1, sy]);
            q.push([sx - 1, sy]);
            q.push([sx, sy + 1]);
            q.push([sx, sy - 1]);
        }

        // Mark lighting dirty (if available) so removed blocks update visuals.
        try {
            const lighting = this.manager.player?.scene?.lighting;
            if (lighting?.markDirty) lighting.markDirty();
        } catch (e) {}
    }
}
