import Signal from './Signal.js';

/**
 * LightingSystem manages torch placement and light propagation.
 * Uses integer-based light levels similar to Minecraft.
 */
export default class LightingSystem {
    constructor(chunkManager, options = {}) {
        this.chunkManager = chunkManager;
        this.maxLight = options.maxLight || 12;
        this.ambientMin = options.ambientMin || 0;
        // Light falloff configuration: lower `falloffFactor` or `falloffPower`
        // produces a softer, longer-reaching light. These can be tuned at
        // LightingSystem construction time (e.g. new LightingSystem(cm, { falloffPower: 1, falloffFactor: 0.6 })).
        this.falloffPower = (typeof options.falloffPower === 'number') ? options.falloffPower : 1.0; // 1 => linear, 2 => quadratic
        this.falloffFactor = (typeof options.falloffFactor === 'number') ? options.falloffFactor : 0.6; // multiplier applied to distance term
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

        // Take several sub-samples inside the world-space position to avoid
        // discrete artifacts when a single sample point flips visibility.
        const samples = [ [0, 0], [0.25, 0.25], [-0.25, 0.25], [0.25, -0.25], [-0.25, -0.25] ];
        let accum = 0;

        for (const s of samples) {
            const samplePx = px + s[0] * noiseTileSize;
            const samplePy = py + s[1] * noiseTileSize;
            const sampleTileX = Math.floor(samplePx / noiseTileSize);
            const sampleTileY = Math.floor(samplePy / noiseTileSize);

            // Sum smooth contributions from all unobstructed torches
            let sumContrib = 0;
            for (const t of this._torchPositions) {
                // distance in tile units from torch center to sample point
                const dx = (t.sx + 0.5) - (samplePx / noiseTileSize);
                const dy = (t.sy + 0.5) - (samplePy / noiseTileSize);
                const dist = Math.hypot(dx, dy);

                // Quick cull: extend reach modestly so softer falloff still has effect
                const level = t.level || this.maxLight;
                const reach = Math.max(1, level * 1.2 + 3);
                if (dist > reach) continue;

                // LOS test between torch tile and target sample tile
                if (!this._isLineOfSightClear(t.sx, t.sy, sampleTileX, sampleTileY)) continue;

                // Softer, configurable falloff: use power * factor instead of strict inverse-square
                // contrib = level / (1 + (dist^power) * factor)
                const contrib = (level) / (1 + Math.pow(dist, this.falloffPower) * this.falloffFactor);
                sumContrib += contrib;
            }

            // Normalize contribution to 0..1 (heuristic based on maxLight)
            const normalized = Math.max(0, Math.min(1, sumContrib / Math.max(1, this.maxLight)));
            accum += normalized;
        }

        const avg = accum / samples.length;
        return this.ambientMin + avg * (1 - this.ambientMin);
    }

    _isLineOfSightClear(x0, y0, x1, y1) {
        // Bresenham line algorithm between integer tile coords; returns false if any intermediate
        // tile (excluding the torch tile) is solid.
        let dx = Math.abs(x1 - x0);
        let sx = x0 < x1 ? 1 : -1;
        let dy = -Math.abs(y1 - y0);
        let sy = y0 < y1 ? 1 : -1;
        let err = dx + dy; /* error value e_xy */

        let cx = x0;
        let cy = y0;

        while (true) {
            // advance to next pixel
            if (cx === x1 && cy === y1) break;
            const e2 = 2 * err;
            if (e2 >= dy) {
                err += dy;
                cx += sx;
            }
            if (e2 <= dx) {
                err += dx;
                cy += sy;
            }

            // If we've reached the destination, stop (do not consider destination blocking)
            if (cx === x1 && cy === y1) break;

            const tile = this.chunkManager.getTileValue(cx, cy);
            if (tile && tile.type === 'solid') return false;
        }

        return true;
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
        // Raycasting approach: cast multiple rays from each torch and write light
        // only into non-solid tiles. This prevents light leaking into/through walls.
        this.lightMap.clear();
        if (this.torches.size === 0) return;

        const raysPerTorch = Math.max(32, Math.min(256, Math.floor(this.maxLight * 8)));
        const step = 0.5; // step size along rays in tile units
        const bounceAtten = 0.45; // how much level remains after a bounce
        const maxBounces = 1;

        for (const [k, torch] of this.torches) {
            const parts = k.split(',');
            if (parts.length < 2) continue;
            const sx = parseInt(parts[0], 10);
            const sy = parseInt(parts[1], 10);
            if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
            const level = torch.level || this.maxLight;

            // Cast rays around the torch
            for (let r = 0; r < raysPerTorch; r++) {
                const ang = (r / raysPerTorch) * Math.PI * 2;
                // step along ray in tile units (fractional)
                const step = 0.5;
                // Extend ray distance to better match prior BFS reach
                const maxDist = Math.max(1, level + 6);

                for (let d = 0; d <= maxDist; d += step) {
                    const fx = sx + 0.5 + Math.cos(ang) * d; // float world tile coords
                    const fy = sy + 0.5 + Math.sin(ang) * d;
                    const tx = Math.floor(fx);
                    const ty = Math.floor(fy);

                    const tile = this.chunkManager.getTileValue(tx, ty);

                    // Use distance-based integer falloff similar to the previous BFS
                    // so reach ~= level - dist. This produces more expected ray lengths.
                    const intLevel = Math.min(this.maxLight, Math.max(0, Math.floor(level - d)));

                    const key = `${tx},${ty}`;
                    const cur = this.lightMap.get(key) || 0;
                    if (intLevel > cur) {
                        this.lightMap.set(key, intLevel);
                    }

                    // If tile is solid, stop the ray but keep the light value on that tile
                    if (tile && tile.type === 'solid') break;
                }
            }
        }
        // Small bloom pass: spread a fraction of each tile's light to neighbors (softens edges)
        const bloomPasses = 1;
        const spreadFactor = 0.2; // fraction to spread to neighbors
        for (let pass = 0; pass < bloomPasses; pass++) {
            const updates = new Map();
            for (const [k, v] of this.lightMap.entries()) {
                const [sx, sy] = k.split(',').map(n => parseInt(n, 10));
                const amount = Math.floor(v * spreadFactor);
                if (amount <= 0) continue;
                const neigh = [ [sx+1,sy], [sx-1,sy], [sx,sy+1], [sx,sy-1] ];
                for (const [nx, ny] of neigh) {
                    const nk = `${nx},${ny}`;
                    const cur = this.lightMap.get(nk) || 0;
                    const upd = Math.min(this.maxLight, cur + amount);
                    const prevUpd = updates.get(nk) || 0;
                    if (upd > prevUpd) updates.set(nk, upd);
                }
            }
            for (const [k, v] of updates.entries()) {
                const cur = this.lightMap.get(k) || 0;
                if (v > cur) this.lightMap.set(k, v);
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
