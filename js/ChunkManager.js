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

        // Placeholder tilesheets for surface and structure placement. These can be
        // assigned images later by the scene or asset loader. For now populate
        // with a few example keys so user code can reference them.
        this.surfaceTileSheet = new TileSheet(null, this.noiseOptions.oreSlicePx);
        this.structureTileSheet = new TileSheet(null, this.noiseOptions.oreSlicePx);
        // Add 5 placeholder keys each (place0..place4, struct0..struct4)
        for (let i = 0; i < 5; i++) {
            this.surfaceTileSheet.addTile(`place${i}`, 0, i);
            this.structureTileSheet.addTile(`struct${i}`, 0, i);
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

    /**
     * Set/override a chunk at chunk-coordinates `cx,cy` with provided data.
     * `data` may be either:
     * - an object { width, height, data } where data is an array of length width*height
     * - a flat numeric array (length will be interpreted as chunkSize*chunkSize)
     * This allows user code to programmatically place structures/surfaces by
     * supplying a tilemap for a chunk.
     */
    setChunk(cx, cy, data) {
        const key = this._chunkKey(cx, cy);
        let chunk = null;

        if (!data) return null;

        if (Array.isArray(data)) {
            // assume square chunk of chunkSize unless array length matches chunkSize*chunkSize
            const w = this.chunkSize;
            const h = Math.max(1, Math.floor(data.length / w));
            chunk = { x: cx, y: cy, width: w, height: h, data: data.slice(0, w * h) };
        } else if (typeof data === 'object' && data.data && Array.isArray(data.data)) {
            const w = data.width || this.chunkSize;
            const h = data.height || Math.max(1, Math.floor(data.data.length / w));
            chunk = { x: cx, y: cy, width: w, height: h, data: data.data.slice(0, w * h) };
        } else {
            // unsupported format
            return null;
        }

        this.chunks.set(key, chunk);
        // If modifiedTiles includes entries inside this chunk, prefer those values
        // (keep modifiedTiles authoritative). Also update blockMap to reflect
        // any explicit 'solid' markers present in the provided chunk data.
        try {
            const startX = cx * this.chunkSize;
            const startY = cy * this.chunkSize;
            for (let y = 0; y < chunk.height; y++) {
                for (let x = 0; x < chunk.width; x++) {
                    const sx = startX + x;
                    const sy = startY + y;
                    const idx = y * chunk.width + x;
                    const raw = chunk.data[idx];
                    const keyTile = `${sx},${sy}`;
                    // If caller provided null/1.0 for empty and 0.0 for solid, keep same interpretation
                    if (this.modifiedTiles.has(keyTile)) continue;
                    if (typeof raw === 'number') {
                        if (raw < 0.999) {
                            // solid
                            this.blockMap.set(keyTile, { type: 'solid' });
                        } else {
                            // empty -> ensure blockMap doesn't claim solidity
                            if (this.blockMap.has(keyTile)) this.blockMap.delete(keyTile);
                        }
                    }
                }
            }
        } catch (e) { /* be robust */ }

        this.onChunkGenerated.emit(cx, cy, chunk);
        return chunk;
    }

    /**
     * Place a horizontal surface line at sample Y coordinate `sy` across chunks
     * from `fromCx` to `toCx` (inclusive). Options support:
     * - onlyIfEmpty: if true, skip a chunk if the target row already contains solids
     * - tileValue: numeric value to write for solid (default 0.0)
     * - emptyValue: numeric value for empty tiles (default 1.0)
     * - tileMeta: optional object to merge into blockMap entries for visuals (e.g., { surface: { tileKey: 'place2' } })
     */
    setHorizontalSurfaceAtSampleY(sy, fromCx, toCx, options = {}) {
        const opts = Object.assign({ onlyIfEmpty: true, tileValue: 0.0, emptyValue: 1.0, tileMeta: null }, options);
        const chunkSize = this.chunkSize;
        if (!Number.isFinite(sy)) return null;

        const cy = Math.floor(sy / chunkSize);
        const localY = sy - cy * chunkSize;
        if (localY < 0 || localY >= chunkSize) return null;

        for (let cx = fromCx; cx <= toCx; cx++) {
            const key = this._chunkKey(cx, cy);
            let chunk = this.chunks.get(key);
            let arr;

            if (chunk && Array.isArray(chunk.data) && chunk.data.length >= chunkSize * chunkSize) {
                arr = chunk.data.slice(); // copy existing
            } else {
                arr = new Array(chunkSize * chunkSize).fill(opts.emptyValue);
            }

            const rowBase = localY * chunkSize;

            // If onlyIfEmpty is set, detect any existing solid in the target row and skip
            if (opts.onlyIfEmpty) {
                let hasSolid = false;
                for (let x = 0; x < chunkSize; x++) {
                    const v = arr[rowBase + x];
                    if (typeof v === 'number' && v < 0.999) { hasSolid = true; break; }
                }
                if (hasSolid) continue;
            }

            // Write the row as solid
            for (let x = 0; x < chunkSize; x++) arr[rowBase + x] = opts.tileValue;

            const newChunk = { x: cx, y: cy, width: chunkSize, height: chunkSize, data: arr };
            // Use setChunk to ensure common handling (modifiedTiles/blockMap updates and signaling)
            try {
                this.setChunk(cx, cy, newChunk);
                // Explicitly set tileMeta for visuals on the written row if provided
                if (opts.tileMeta) {
                    const startX = cx * chunkSize;
                    for (let x = 0; x < chunkSize; x++) {
                        const sx = startX + x;
                        const syAbs = cy * chunkSize + localY;
                        const tkey = `${sx},${syAbs}`;
                        if (this.modifiedTiles.has(tkey)) continue;
                        if (this.blockMap.has(tkey)) {
                            const existing = this.blockMap.get(tkey) || { type: 'solid' };
                            Object.assign(existing, opts.tileMeta);
                            this.blockMap.set(tkey, existing);
                        }
                    }
                }
                // Debug log for visibility when testing
                // eslint-disable-next-line no-console
                console.log('[ChunkManager] setHorizontalSurface wrote chunk', cx, cy);
            } catch (e) {
                // fallback: write raw
                this.chunks.set(key, newChunk);
                console.warn('[ChunkManager] failed to setChunk, fallback to direct write', e);
            }
        }

        return true;
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
