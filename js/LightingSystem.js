import Signal from './Signal.js';

/**
 * LightingSystem manages torch placement and light propagation.
 * Uses integer-based light levels similar to Minecraft.
 */
export default class LightingSystem {
    constructor(chunkManager, options = {}) {
        this.chunkManager = chunkManager;
        this.maxLight = options.maxLight || 0;
        this.ambientMin = options.ambientMin || 0;
        // Threshold above which ores should be revealed. If brightness is below
        // this value, ores will be masked as stone. Can be overridden via options.
        this.oreRevealThreshold = (typeof options.oreRevealThreshold === 'number')
            ? options.oreRevealThreshold
            : Math.max(this.ambientMin + 0.05, 0.3);

        this.torches = new Map(); // key: "sx,sy" -> { level: number }
        this.lightMap = new Map(); // key: "sx,sy" -> number (0..maxLight)
        this._isDirty = true;
        // Cached torch positions for fast per-sprite queries: [{sx,sy,level}, ...]
        this._torchPositions = [];

        // Signals
        this.onLightChanged = new Signal();

        // Listen to chunk modifications to mark lighting dirty
        if (this.chunkManager.onTileModified) {
            this.chunkManager.onTileModified.connect(() => {
                this.markDirty();
            });
        }
        // initialize cache from any pre-existing torches
        this._rebuildTorchCache();
    }

    /**
     * Toggle torch at a tile location
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @returns {boolean} True if torch was added, false if removed
     */
    toggleTorch(sx, sy) {
        const key = `${sx},${sy}`;

        if (this.torches.has(key)) {
            this.torches.delete(key);
            this._updateTorchCacheRemove(sx, sy);
            this.markDirty();
            return false;
        } else {
            // Only place torch if tile is empty
            const tile = this.chunkManager.getTileValue(sx, sy);
            if (!tile) {
                this.torches.set(key, { level: this.maxLight });
                this._updateTorchCacheAdd(sx, sy, this.maxLight);
                this.markDirty();
                return true;
            }
            return false;
        }
    }

    /**
     * Remove torch at location
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     */
    removeTorch(sx, sy) {
        const key = `${sx},${sy}`;
        if (this.torches.has(key)) {
            this.torches.delete(key);
            this._updateTorchCacheRemove(sx, sy);
            this.markDirty();
        }
    }

    _rebuildTorchCache() {
        this._torchPositions = [];
        for (const [k, t] of this.torches) {
            const parts = k.split(',');
            if (parts.length < 2) continue;
            const sx = parseInt(parts[0], 10);
            const sy = parseInt(parts[1], 10);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            this._torchPositions.push({ sx, sy, level: t && t.level ? t.level : this.maxLight });
        }
    }

    _updateTorchCacheAdd(sx, sy, level) {
        // remove existing entry if present
        this._torchPositions = this._torchPositions.filter(p => !(p.sx === sx && p.sy === sy));
        this._torchPositions.push({ sx, sy, level: level || this.maxLight });
    }

    _updateTorchCacheRemove(sx, sy) {
        this._torchPositions = this._torchPositions.filter(p => !(p.sx === sx && p.sy === sy));
    }

    /**
     * Compute brightness for a world-space position (px,py) using cached torches.
     * Returns a brightness factor in [ambientMin..1].
     */
    getBrightnessForWorld(px, py, noiseTileSize) {
        if (!noiseTileSize || !this._torchPositions || this._torchPositions.length === 0) {
            return this.ambientMin;
        }
        const sx = Math.floor(px / noiseTileSize);
        const sy = Math.floor(py / noiseTileSize);

        let maxLevel = 0;
        for (const t of this._torchPositions) {
            const dx = t.sx - sx;
            const dy = t.sy - sy;
            const dist = Math.hypot(dx, dy);
            // approximate light falloff: level ~= maxLight - dist
            const lvl = Math.max(0, Math.floor((t.level || this.maxLight) - dist));
            if (lvl > maxLevel) maxLevel = lvl;
            if (maxLevel >= this.maxLight) break;
        }

        const normalized = Math.max(0, Math.min(this.maxLight, maxLevel)) / Math.max(1, this.maxLight);
        return this.ambientMin + normalized * (1 - this.ambientMin);
    }

    /**
     * Get light level at a tile
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @returns {number} Light level (0..maxLight)
     */
    getLightLevel(sx, sy) {
        const key = `${sx},${sy}`;
        return this.lightMap.get(key) || 0;
    }

    /**
     * Get brightness factor (0..1) for rendering
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @returns {number} Brightness (0..1)
     */
    getBrightness(sx, sy) {
        const level = this.getLightLevel(sx, sy);
        const normalized = Math.max(0, Math.min(this.maxLight, level)) / Math.max(1, this.maxLight);
        return this.ambientMin + normalized * (1 - this.ambientMin);
    }

    /**
     * Mark lighting as needing recomputation
     */
    markDirty() {
        this._isDirty = true;
    }

    /**
     * Update lighting if dirty
     */
    update() {
        if (this._isDirty) {
            this._recomputeLighting();
            this._isDirty = false;
            this.onLightChanged.emit();
        }
    }

    /**
     * Get all torches
     * @returns {Map} Torches map
     */
    getTorches() {
        return this.torches;
    }

    // --- Private methods ---

    _recomputeLighting() {
        this.lightMap.clear();
        if (this.torches.size === 0) return;

        const queue = [];
        const push = (sx, sy, level) => {
            const k = `${sx},${sy}`;
            const cur = this.lightMap.get(k) || 0;
            if (level <= cur) return;
            this.lightMap.set(k, level);
            queue.push({ sx, sy, level });
        };

        // Seed with torches
        for (const [k, torch] of this.torches) {
            const parts = k.split(',');
            if (parts.length < 2) continue;
            const sx = parseInt(parts[0], 10);
            const sy = parseInt(parts[1], 10);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const level = torch.level || this.maxLight;
            push(sx, sy, Math.min(this.maxLight, Math.max(0, Math.floor(level))));
        }

        // BFS propagation with 4-neighborhood
        while (queue.length) {
            const cur = queue.shift();
            const nextLevel = cur.level - 1;
            if (nextLevel <= 0) continue;

            const neighbors = [
                [cur.sx + 1, cur.sy],
                [cur.sx - 1, cur.sy],
                [cur.sx, cur.sy + 1],
                [cur.sx, cur.sy - 1]
            ];

            for (const [nx, ny] of neighbors) {
                const tile = this.chunkManager.getTileValue(nx, ny);
                const isSolid = (tile && tile.type === 'solid');
                const key = `${nx},${ny}`;
                const curVal = this.lightMap.get(key) || 0;

                if (nextLevel > curVal) {
                    this.lightMap.set(key, nextLevel);
                    // Only propagate if not solid
                    if (!isSolid) {
                        queue.push({ sx: nx, sy: ny, level: nextLevel });
                    }
                }
            }
        }
    }

    /**
     * Helper to modulate a hex color by brightness
     * @param {string} hex - Hex color
     * @param {number} brightness - Brightness factor (0..1)
     * @returns {string} RGBA color string
     */
    static modulateColor(hex, brightness) {
        if (!hex) return `rgba(0,0,0,${brightness})`;
        let h = hex.replace('#', '');
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        const n = parseInt(h, 16);
        const r = Math.max(0, Math.min(255, Math.round(((n >> 16) & 255) * brightness)));
        const g = Math.max(0, Math.min(255, Math.round(((n >> 8) & 255) * brightness)));
        const b = Math.max(0, Math.min(255, Math.round((n & 255) * brightness)));
        return `rgba(${r},${g},${b},1.0)`;
    }
}
