import { perlinNoise } from './noiseGen.js';
import Signal from './Signal.js';
import TileSheet from './Tilesheet.js';

/**
 * ChunkManager handles procedural terrain generation and tile queries.
 * Generates chunks on-demand using Perlin noise and manages explicit tile modifications.
 */
export default class ChunkManager {
    constructor(options = {}) {
        this.chunkSize = options.chunkSize || 16;
        this.noiseTileSize = options.noiseTileSize || 8;
        this.noiseOptions = options.noiseOptions || {
            width: 64, height: 64, scale: 24, octaves: 4,
            seed: 1337, normalize: false, split: 0.2,
            offsetX: 0, offsetY: 0, bridgeWidth: 2, connect: true
        };

        // Ore generation configuration
        this.noiseOptions.oreChance = this.noiseOptions.oreChance || 0.2;
        this.noiseOptions.oreSlicePx = this.noiseOptions.oreSlicePx || 16;

        // Prepare a tilesheet placeholder for ores (image may be set later by package/scene)
        this.oreTileSheet = new TileSheet(null, this.noiseOptions.oreSlicePx);
        // Populate tile meta for a typical 64x64 / 16px slice grid (4x4)
        const cols = 64 / this.noiseOptions.oreSlicePx;
        const rows = 64 / this.noiseOptions.oreSlicePx;
        let idx = 0;
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                this.oreTileSheet.addTile(`ore${idx}`, r, c);
                idx++;
            }
        }

        this.chunks = new Map(); // key: "cx,cy" -> { x, y, data, width, height }
        this.modifiedTiles = new Map(); // key: "sx,sy" -> tile data or null
        this.blockMap = new Map(); // key: "sx,sy" -> { type: 'solid'|'ladder' }
        this.lastGeneratedChunk = null;

        // Signals
        this.onChunkGenerated = new Signal();
        this.onTileModified = new Signal();
    }

    /**
     * Generate chunks around a world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldY - World Y coordinate
     * @param {number} radius - Chunk radius to generate
     */
    generateChunksAround(worldX, worldY, radius = 1) {
        const sampleX = Math.floor(worldX / this.noiseTileSize);
        const sampleY = Math.floor(worldY / this.noiseTileSize);
        const cx = Math.floor(sampleX / this.chunkSize);
        const cy = Math.floor(sampleY / this.chunkSize);
        const ck = `${cx},${cy}`;

        if (this.lastGeneratedChunk === ck) return;

        this.lastGeneratedChunk = ck;
        for (let dy = -radius; dy <= radius; dy++) {
            for (let dx = -radius; dx <= radius; dx++) {
                const ncx = cx + dx;
                const ncy = cy + dy;
                this._ensureChunk(ncx, ncy);
            }
        }
    }

    /**
     * Get tile value at sample coordinates
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @returns {Object|null} Tile data { type: 'solid'|'ladder' } or null
     */
    getTileValue(sx, sy) {
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;

        const mkey = `${sx},${sy}`;

        // Check explicit modifications first
        if (this.modifiedTiles.has(mkey)) {
            const v = this.modifiedTiles.get(mkey);
            if (v === null) return null;
            if (typeof v === 'object') return v;
            // Legacy numeric support
            if (typeof v === 'number') return (v < 0.999) ? { type: 'solid' } : null;
            return null;
        }

        // Check explicit block placements
        if (this.blockMap.has(mkey)) {
            return this.blockMap.get(mkey);
        }

        // Query chunk data
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const chunk = this._ensureChunk(cx, cy);
        if (!chunk) return null;

        const lx = sx - cx * this.chunkSize;
        const ly = sy - cy * this.chunkSize;
        if (lx < 0 || ly < 0 || lx >= chunk.width || ly >= chunk.height) return null;

        const raw = chunk.data[ly * chunk.width + lx];
        // Interpret raw noise: <0.999 => solid, >=0.999 => empty
        if (typeof raw === 'number' && raw < 0.999) return { type: 'solid' };
        return null;
    }

    /**
     * Set a tile to a specific value (mining, placing, etc.)
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @param {Object|null} value - Tile data or null for empty
     */
    setTileValue(sx, sy, value) {
        const key = `${sx},${sy}`;
        this.modifiedTiles.set(key, value);

        // Update chunk data if already generated
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const ckey = this._chunkKey(cx, cy);
        const chunk = this.chunks.get(ckey);

        if (chunk) {
            const lx = sx - cx * this.chunkSize;
            const ly = sy - cy * this.chunkSize;
            if (lx >= 0 && ly >= 0 && lx < chunk.width && ly < chunk.height) {
                chunk.data[ly * chunk.width + lx] = value === null ? 1.0 : 0.0;
            }
        }

        this.onTileModified.emit(sx, sy, value);
    }

    /**
     * Remove block data at a tile location
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     */
    removeBlock(sx, sy) {
        const key = `${sx},${sy}`;
        if (this.blockMap.has(key)) {
            this.blockMap.delete(key);
            this.onTileModified.emit(sx, sy, null);
        }
    }

    /**
     * Get all chunks
     * @returns {Map} The chunks map
     */
    getChunks() {
        return this.chunks;
    }

    // --- Private methods ---

    _chunkKey(cx, cy) {
        return `${cx},${cy}`;
    }

    _ensureChunk(cx, cy) {
        const key = this._chunkKey(cx, cy);
        if (this.chunks.has(key)) return this.chunks.get(key);

        const chunk = this._generateChunk(cx, cy);
        this.chunks.set(key, chunk);
        this.onChunkGenerated.emit(cx, cy, chunk);
        return chunk;
    }

    _generateChunk(cx, cy) {
        const startX = cx * this.chunkSize;
        const startY = cy * this.chunkSize;

        const opts = Object.assign({}, this.noiseOptions);
        delete opts.width;
        delete opts.height;
        opts.offsetX = startX;
        opts.offsetY = startY;

        const map = perlinNoise(this.chunkSize, this.chunkSize, opts);

        // Generate ladder columns deterministically
        this._generateLadders(startX, startY, map);
        // Generate ore deposits deterministically (based on seed)
        this._generateOre(startX, startY, map);

        return {
            x: cx,
            y: cy,
            width: map.width,
            height: map.height,
            data: map.data
        };
    }

    _generateLadders(startX, startY, map) {
        const raw = map.data;
        const w = map.width;
        const h = map.height;
        const seed = this.noiseOptions.seed || 1337;
        const columnChance = this.noiseOptions.ladderChance || 0.02;

        // Deterministic pseudo-random per column
        const pseudo = (s, n) => {
            const x = n * 12.9898 + s * 78.233;
            const v = Math.sin(x) * 43758.5453123;
            return v - Math.floor(v);
        };

        for (let xx = 0; xx < w; xx++) {
            const globalSx = startX + xx;
            const r = pseudo(seed, globalSx);
            if (r >= columnChance) continue;

            // Place ladder for entire column
            for (let y = 0; y < h; y++) {
                const globalSy = startY + y;
                const key = `${globalSx},${globalSy}`;
                if (this.modifiedTiles.has(key)) continue;
                this.blockMap.set(key, { type: 'ladder' });
            }
        }

        // Remove ladders where solid blocks exist
        for (let y = 0; y < h; y++) {
            for (let xx = 0; xx < w; xx++) {
                const v = raw[y * w + xx];
                if (typeof v === 'number' && v < 0.999) {
                    const sx = startX + xx;
                    const sy = startY + y;
                    const key = `${sx},${sy}`;
                    if (!this.modifiedTiles.has(key) && this.blockMap.has(key)) {
                        this.blockMap.delete(key);
                    }
                }
            }
        }
    }
    _generateOre(startX, startY, map) {
        const raw = map.data;
        const w = map.width;
        const h = map.height;
        const seed = this.noiseOptions.seed || 1337;
        const oreChance = this.noiseOptions.oreChance || 0.02;

        // Count available ore variants in the oreTileSheet
        let variants = 0;
        try {
            if (this.oreTileSheet && this.oreTileSheet.tiles instanceof Map) variants = this.oreTileSheet.tiles.size;
            else if (this.oreTileSheet && this.oreTileSheet.tiles) variants = Object.keys(this.oreTileSheet.tiles).length;
        } catch (e) { variants = 0; }

        const pseudo = (s, x, y) => {
            const n = x * 374761393 + y * 668265263 + (s | 0) * 1274126177;
            const v = Math.sin(n) * 43758.5453123;
            return v - Math.floor(v);
        };

        for (let y = 0; y < h; y++) {
            for (let xx = 0; xx < w; xx++) {
                const v = raw[y * w + xx];
                // only embed ore inside solid tiles
                if (typeof v === 'number' && v < 0.999) {
                    const sx = startX + xx;
                    const sy = startY + y;
                    const key = `${sx},${sy}`;
                    if (this.modifiedTiles.has(key)) continue; // don't overwrite explicit edits

                    const r = pseudo(seed, sx, sy);
                    if (r < oreChance) {
                        // choose variant deterministically
                        const pick = variants > 0 ? Math.floor(pseudo(seed + 1, sx, sy) * variants) : 0;
                        const variantName = `ore${Math.max(0, pick % Math.max(1, variants))}`;
                        const meta = { type: 'solid' };
                        if (variants > 0) meta.ore = { tileKey: variantName };
                        this.blockMap.set(key, meta);
                    }
                }
            }
        }
    }
}
