import { perlinNoise } from '../utils/noiseGen.js';
import Signal from '../modules/Signal.js';
import TileSheet from '../modules/Tilesheet.js';
import Vector from '../modules/Vector.js';

/**
 * @typedef {Object} BlockDef
 * @property {string} id - Block identifier
 * @property {Object} [data] - Arbitrary metadata from `data/blocks.json` (e.g. hardness, mode)
 * @property {Object} [texture] - Texture descriptor if present
 */

/**
 * ChunkManager handles procedural terrain generation and tile queries.
 * Generates chunks on-demand using Perlin noise and manages explicit tile modifications.
 */
export default class ChunkManager {
    constructor(options = {}) {
        // Basic sizing and options (allow overrides via `options`)
        this.chunkSize = Number.isFinite(options.chunkSize) ? options.chunkSize : 16;
        this.noiseTileSize = Number.isFinite(options.noiseTileSize) ? options.noiseTileSize : 16;
        const tilePx = Number.isFinite(options.tilePx) ? options.tilePx : this.noiseTileSize;

        // Default noise options; user-supplied options.noiseOptions will override these
        const defaultNoise = {
            width: this.chunkSize,
            height: this.chunkSize,
            scale: 24,
            octaves: 4,
            seed: (options.noiseOptions && Number.isFinite(options.noiseOptions.seed)) ? options.noiseOptions.seed : 0,
            normalize: true,
            split: false,
            offsetX: 0,
            offsetY: 0,
            bridgeWidth: 2,
            connect: false,
            threshold: 0.5,
            seedOffset: 0,
        };
        this.noiseOptions = Object.assign({}, defaultNoise, options.noiseOptions || {});

        // Internal state
        this.chunks = new Map(); // key: "cx,cy" -> { x, y, data, width, height }
        this.modifiedTiles = new Map(); // key: "sx,sy" -> tile data or null
        this.blockMap = new Map(); // key: "sx,sy" -> { type: 'solid'|'ladder' }
        this.lastGeneratedChunk = null;
        this.lightingSystem = null;
        // Signals
        this.onChunkGenerated = new Signal();
        this.onTileModified = new Signal();

        // JSON-driven generation specs (loaded via loadDefinitions)
        this.chunkSpecs = null; // contents of data/chunks.json
        this.generationSpec = null; // contents of data/generation.json
        this.blockDefs = null; // Map of block id -> metadata (from data/blocks.json)
    }

    /**
     * Load external JSON definitions for chunks, generation rules, and blocks.
     * This is async and should be called once at startup by the scene/engine.
     */
    async loadDefinitions(basePath = './data') {
        try {
            const chunksResp = await fetch(`${basePath}/chunks.json`, { cache: 'no-cache' });
            if (chunksResp.ok) this.chunkSpecs = await chunksResp.json();
        } catch (e) { console.warn('ChunkManager.loadDefinitions: failed to load chunks.json', e); }

        try {
            const genResp = await fetch(`${basePath}/generation.json`, { cache: 'no-cache' });
            if (genResp.ok) this.generationSpec = await genResp.json();
        } catch (e) { console.warn('ChunkManager.loadDefinitions: failed to load generation.json', e); }

        try {
            const blocksResp = await fetch(`${basePath}/blocks.json`, { cache: 'no-cache' });
            if (blocksResp.ok) {
                const bj = await blocksResp.json();
                this.blockDefs = new Map();
                if (bj.blocks && typeof bj.blocks === 'object') {
                    for (const k of Object.keys(bj.blocks)) {
                        this.blockDefs.set(k, bj.blocks[k]);
                    }
                }
            }
        } catch (e) { console.warn('ChunkManager.loadDefinitions: failed to load blocks.json', e); }

        return { chunks: this.chunkSpecs, generation: this.generationSpec, blocks: this.blockDefs };
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
            if (typeof v === 'string') {
                const def = (this.blockDefs && this.blockDefs instanceof Map) ? this.blockDefs.get(v) : null;
                const mode = def && def.data && def.data.mode ? def.data.mode : 'solid';
                return { type: mode, id: v, meta: def || null };
            }
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
        // New JSON-driven format: chunk.data can store block id strings or objects with metadata
        if (typeof raw === 'string') {
            if (raw === 'air' || raw === '' || raw === null) return null;
            // lookup block definition if available to determine solidity
            try {
                const def = (this.blockDefs && this.blockDefs instanceof Map) ? this.blockDefs.get(raw) : null;
                const mode = def && def.data && def.data.mode ? def.data.mode : 'solid';
                if (mode === 'solid') return { type: 'solid', id: raw, meta: def || null };
                return { type: mode || 'solid', id: raw, meta: def || null };
            } catch (e) {
                return { type: 'solid', id: raw };
            }
        } else if (typeof raw === 'object' && raw !== null && raw.id) {
            // Object format with id, rot, invert, etc.
            if (raw.id === 'air' || raw.id === '') return null;
            try {
                const def = (this.blockDefs && this.blockDefs instanceof Map) ? this.blockDefs.get(raw.id) : null;
                const mode = def && def.data && def.data.mode ? def.data.mode : 'solid';
                return { 
                    type: mode, 
                    id: raw.id, 
                    meta: def || null,
                    rot: raw.rot !== undefined ? raw.rot : 0,
                    invert: raw.invert !== undefined ? raw.invert : false
                };
            } catch (e) {
                return { type: 'solid', id: raw.id, rot: raw.rot || 0, invert: raw.invert || false };
            }
        }

        // Legacy numeric support (kept minimal for backwards compatibility)
        if (typeof raw === 'number' && raw < 0.999) return { type: 'solid' };
        return null;
    }

    /**
     * Set a tile to a specific value (mining, placing, etc.)
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @param {String|Object|null} value - Tile data or null for empty
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
                // Write block ids into the JSON-driven chunk data.
                // Accept several value shapes: null -> 'air', string -> use as block id,
                // object -> preserve full metadata including rot/invert
                let out;
                if (value === null) out = 'air';
                else if (typeof value === 'string') out = value;
                else if (typeof value === 'object' && value.id) {
                    // Preserve rotation and invert if present
                    out = { id: value.id };
                    if (value.rot !== undefined) out.rot = value.rot;
                    if (value.invert !== undefined) out.invert = value.invert;
                } else out = 'stone';
                chunk.data[ly * chunk.width + lx] = out;
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

    _matchesGenerationConditions(conds, cx, cy) {
        if (!conds || !Array.isArray(conds) || conds.length === 0) return false;
        const chunkSize = this.chunkSize;
        // Use chunk top-left coordinates (startX/startY) for condition evaluation
        const startX = cx * chunkSize;
        const startY = cy * chunkSize;

        for (const c of conds) {
            if (!c || !c.type) continue;
            const meta = c.data && c.data.meta ? c.data.meta : null;
            if (c.type === 'y' && Array.isArray(meta)) {
                const op = meta[0];
                const val = Number(meta[1] || 0);
                if (op === 'below') { if (!(startY < val)) return false; }
                else if (op === 'above') { if (!(startY > val)) return false; }
                else if (op === 'equal') { if (!(startY === val)) return false; }
            } else if (c.type === 'x' && Array.isArray(meta)) {
                const op = meta[0];
                const val = Number(meta[1] || 0);
                if (op === 'below') { if (!(startX < val)) return false; }
                else if (op === 'above') { if (!(startX > val)) return false; }
                else if (op === 'equal') { if (!(startX === val)) return false; }
            } else if (c.type === 'chance' && Array.isArray(meta)) {
                const prob = Number(meta[0] || 0);
                const seed = (this.noiseOptions && this.noiseOptions.seed) ? this.noiseOptions.seed : 1337;
                // use startX/startY for deterministic chunk-level randomness
                const n = startX * 374761393 + startY * 668265263 + (seed|0) * 1274126177;
                const v = Math.sin(n) * 43758.5453123;
                const r = v - Math.floor(v);
                if (!(r < prob)) return false;
            } else {
                // unknown condition types are treated as non-matching
                return false;
            }
        }
        return true;
    }

    _ensureChunk(cx, cy) {
        const key = this._chunkKey(cx, cy);
        if (this.chunks.has(key)) return this.chunks.get(key);
        let chunk;
        // Always use JSON-driven generation. If there are no definitions,
        // _generateChunkJSON will return an empty 'air' chunk.
        chunk = this._generateChunkJSON(cx, cy);

        this.chunks.set(key, chunk);
        this.onChunkGenerated.emit(cx, cy, chunk);
        return chunk;
    }

    /**
     * Generate a chunk using the JSON-driven specs (chunks.json + generation.json)
     */
    _generateChunkJSON(cx, cy) {
        const chunkSize = this.chunkSize;
        const startX = cx * chunkSize;
        const startY = cy * chunkSize;

        
        // Select generation rule from generationSpec by evaluating conditions
        let selected = null;
        if (this.generationSpec && typeof this.generationSpec === 'object') {
            for (const key of Object.keys(this.generationSpec)) {
                const rule = this.generationSpec[key];
                const conds = rule.conditions || [];
                if (this._matchesGenerationConditions(conds, cx, cy)) { selected = rule; break; }
            }
        }

        // Determine chunk type and spec
        let chunkType = null;
        if (selected) {
            if (selected.chunk_type) {
                chunkType = selected.chunk_type;
            } else if (Array.isArray(selected.chunk_types) && selected.chunk_types.length > 0) {
                // Deterministically pick one of the chunk_types using a pseudo-random
                // value derived from chunk top-left and the configured seed so world
                // generation is repeatable.
                const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? this.noiseOptions.seed : 1337;
                const n = startX * 374761393 + startY * 668265263 + (seed|0) * 1274126177;
                const v = Math.sin(n) * 43758.5453123;
                let r = v - Math.floor(v);

                // Normalize the chances (allow config that doesn't sum to 1)
                let total = 0;
                for (const t of selected.chunk_types) total += Number(t && t.chance) || 0;
                if (total <= 0) total = selected.chunk_types.length;

                let cum = 0;
                let chosenName = (selected.chunk_types[0] && selected.chunk_types[0].name) ? selected.chunk_types[0].name : null;
                for (const t of selected.chunk_types) {
                    const prob = (Number(t && t.chance) || 0) / total;
                    cum += prob;
                    if (r < cum) { chosenName = t && t.name ? t.name : chosenName; break; }
                }
                chunkType = chosenName;
            }
        }
        // Default empty chunk filled with 'air'        
        const arr = new Array(chunkSize * chunkSize).fill('air');
        const spec = (this.chunkSpecs && this.chunkSpecs.chunks && this.chunkSpecs.chunks[chunkType]) ? this.chunkSpecs.chunks[chunkType] : null;
        if (!spec) {
            // No spec available: return a default empty chunk (all 'air').
            return { x: cx, y: cy, width: chunkSize, height: chunkSize, data: arr };
        }
        arr.fill(spec.data.bg)
        
        // Fill regions
        try {
            const regions = spec.data && spec.data.regions ? spec.data.regions : [];

            for (const reg of regions) {
                const r0 = reg.region && reg.region[0] ? reg.region[0] : [0,0];
                const r1 = reg.region && reg.region[1] ? reg.region[1] : [chunkSize-1, chunkSize-1];
                const bx = Math.max(0, Math.min(chunkSize-1, r0[0]));
                const by = Math.max(0, Math.min(chunkSize-1, r0[1]));
                const ex = Math.max(0, Math.min(chunkSize-1, r1[0]));
                const ey = Math.max(0, Math.min(chunkSize-1, r1[1]));
                const blockType = reg.block_type || 'stone';
                // Check for rotation/invert in special metadata
                const rot = reg.special && reg.special.rot !== undefined ? reg.special.rot : 0;
                const invert = reg.special && reg.special.invert !== undefined ? reg.special.invert : false;
                const hasTransform = rot !== 0 || invert !== false;
                
                for (let y = by; y <= ey; y++) {
                    for (let x = bx; x <= ex; x++) {
                        if (hasTransform) {
                            arr[y * chunkSize + x] = { id: blockType, rot: rot, invert: invert };
                        } else {
                            arr[y * chunkSize + x] = blockType;
                        }
                    }
                }
            }
            // After filling regions, apply cave carving as a post-process for ground chunks
            try {
                for (const s of selected.special) {
                    if (!s || s.type !== 'caves') continue;
                    const sd = s.data || {};
                    // Start from default noise options, then apply cave-specific overrides
                    const nopts = Object.assign({}, this.noiseOptions);
                    if (typeof sd.scale === 'number') nopts.scale = sd.scale;
                    if (typeof sd.octaves === 'number') nopts.octaves = sd.octaves;
                    if (typeof sd.persistence === 'number') nopts.persistence = sd.persistence;
                    if (typeof sd.lacunarity === 'number') nopts.lacunarity = sd.lacunarity;
                    if (typeof sd.normalize === 'boolean') nopts.normalize = sd.normalize;
                    if (typeof sd.split === 'number') nopts.split = sd.split;
                    if (typeof sd.connect === 'boolean') nopts.connect = sd.connect;
                    if (typeof sd.bridgeWidth === 'number') nopts.bridgeWidth = sd.bridgeWidth;
                    // seed: prefer explicit seed, otherwise apply seedOffset to base seed
                    if (Number.isFinite(sd.seed)) nopts.seed = sd.seed;
                    else if (Number.isFinite(sd.seedOffset)) nopts.seed = (this.noiseOptions.seed || 0) + sd.seedOffset;
                    // offsets: allow per-special offsets added to chunk start
                    const extraOX = Number.isFinite(sd.offsetX) ? sd.offsetX : 0;
                    const extraOY = Number.isFinite(sd.offsetY) ? sd.offsetY : 0;
                    nopts.offsetX = (startX || 0) + extraOX;
                    nopts.offsetY = (startY || 0) + extraOY;

                    const caveMap = perlinNoise(chunkSize, chunkSize, nopts);
                    const threshold = (sd.threshold !== undefined) ? sd.threshold : 0.5;

                    for (let y = 0; y < chunkSize; y++) {
                        for (let x = 0; x < chunkSize; x++) {
                            const idx = y * chunkSize + x;
                            const v = caveMap.data[idx];
                            if (typeof v !== 'number') continue;

                            let carve = false;
                            // If split was requested, perlinNoise produced a binary map (0/1)
                            // NOTE: Invert carving logic so that 1 => cavity when using split
                            if (Number.isFinite(nopts.split) && nopts.split >= 0) {
                                // treat 1 as cavity (air) and 0 as solid (inverted compared to previous behavior)
                                if (v === 1) carve = true;
                            } else {
                                // Normalize raw output to 0..1 if the noise wasn't normalized
                                let val = v;
                                if (!nopts.normalize) val = (v + 1) / 2; // map [-1,1] -> [0,1]
                                // Inverted: carve when value is above the threshold
                                if (val > threshold) carve = true;
                            }

                            if (carve) arr[idx] = 'air';
                        }
                    }
                }

            } catch (e) { /* ignore cave carve errors */ }

            // Apply region-local specials (e.g., ores defined inside a region)
            for (const reg of regions) {
                if (!reg || !reg.special) continue;
                const s = reg.special;
                if (!s || !s.type) continue;
                // compute region bounds again
                const r0 = reg.region && reg.region[0] ? reg.region[0] : [0,0];
                const r1 = reg.region && reg.region[1] ? reg.region[1] : [chunkSize-1, chunkSize-1];
                const bx = Math.max(0, Math.min(chunkSize-1, r0[0]));
                const by = Math.max(0, Math.min(chunkSize-1, r0[1]));
                const ex = Math.max(0, Math.min(chunkSize-1, r1[0]));
                const ey = Math.max(0, Math.min(chunkSize-1, r1[1]));

                if (s.type === 'ores') {
                    const spread = (s.data && s.data.spread) ? s.data.spread : [];
                    const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? this.noiseOptions.seed : 1337;
                    const pseudo = (a, x, y) => { const n = x * 374761393 + y * 668265263 + (a|0) * 1274126177; const v = Math.sin(n) * 43758.5453123; return v - Math.floor(v); };
                    for (let y = by; y <= ey; y++) {
                        for (let x = bx; x <= ex; x++) {
                            const idx = y * chunkSize + x;
                            const cur = arr[idx];
                            if (typeof cur === 'string' && cur !== 'air') {
                                for (let i = 0; i < spread.length; i++) {
                                    const sopt = spread[i];
                                    const chance = Number(sopt.chance || 0);
                                    const pick = sopt.block_type;
                                    // compute a per-ore random value so multiple ore types can be selected
                                    const r = pseudo(seed + i * 2654435761, startX + x, startY + y);
                                    if (r < chance) { arr[idx] = pick; break; }
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }

        // Apply special rules from selected generation rule
        try {
            if (selected && Array.isArray(selected.special)) {
                for (const s of selected.special) {
                    if (!s || !s.type) continue;
                    if (s.type === 'caves') {
                        const sd = s.data || {};
                        const nopts = Object.assign({}, this.noiseOptions);
                        if (typeof sd.scale === 'number') nopts.scale = sd.scale;
                        if (typeof sd.octaves === 'number') nopts.octaves = sd.octaves;
                        if (typeof sd.seedOffset === 'number') nopts.seed = (this.noiseOptions.seed || 0) + sd.seedOffset;
                        nopts.offsetX = startX; nopts.offsetY = startY;
                        const caveMap = perlinNoise(chunkSize, chunkSize, nopts);
                        const threshold = (sd.threshold !== undefined) ? sd.threshold : 0.5;
                        for (let y = 0; y < chunkSize; y++) {
                            for (let x = 0; x < chunkSize; x++) {
                                const v = caveMap.data[y * chunkSize + x];
                                if (typeof v === 'number' && v < threshold) arr[y * chunkSize + x] = 'air';
                            }
                        }
                    } else if (s.type === 'ores') {
                        const spread = (s.data && s.data.spread) ? s.data.spread : [];
                        const seed = (this.noiseOptions && this.noiseOptions.seed) ? this.noiseOptions.seed : 1337;
                        const pseudo = (a, x, y) => { const n = x * 374761393 + y * 668265263 + (a|0) * 1274126177; const v = Math.sin(n) * 43758.5453123; return v - Math.floor(v); };
                        for (let y = 0; y < chunkSize; y++) {
                            for (let x = 0; x < chunkSize; x++) {
                                const idx = y * chunkSize + x;
                                const cur = arr[idx];
                                if (typeof cur === 'string' && cur !== 'air') {
                                    for (const sopt of spread) {
                                        const chance = Number(sopt.chance || 0);
                                        const pick = sopt.block_type;
                                        const r = pseudo(seed, startX + x, startY + y);
                                        if (r < chance) { arr[idx] = pick; break; }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }

        return { x: cx, y: cy, width: chunkSize, height: chunkSize, data: arr };
    }

    /**
     * Set/override a chunk at chunk-coordinates `cx,cy` with provided data.
     * `data` may be either:
     * - a string (chunk type name from chunks.json, will generate chunk data using that spec)
     * - an object { width, height, data } where data is an array of length width*height
     * - a flat numeric array (length will be interpreted as chunkSize*chunkSize)
     * This allows user code to programmatically place structures/surfaces by
     * supplying a tilemap for a chunk.
     */
    setChunk(cx, cy, data) {
        const key = this._chunkKey(cx, cy);
        let chunk = null;

        if (!data) return null;

        if (typeof data === 'string') {
            // Treat as chunk type name and generate using that spec
            const chunkSize = this.chunkSize;
            const startX = cx * chunkSize;
            const startY = cy * chunkSize;
            const arr = new Array(chunkSize * chunkSize).fill('air');
            const spec = (this.chunkSpecs && this.chunkSpecs.chunks && this.chunkSpecs.chunks[data]) ? this.chunkSpecs.chunks[data] : null;
            
            if (!spec) {
                // No spec found for this chunk name, return empty chunk
                chunk = { x: cx, y: cy, width: chunkSize, height: chunkSize, data: arr };
            } else {
                // Fill with background
                arr.fill(spec.data.bg || 'air');
                
                // Fill regions
                try {
                    const regions = spec.data && spec.data.regions ? spec.data.regions : [];
                    for (const reg of regions) {
                        const r0 = reg.region && reg.region[0] ? reg.region[0] : [0,0];
                        const r1 = reg.region && reg.region[1] ? reg.region[1] : [chunkSize-1, chunkSize-1];
                        const bx = Math.max(0, Math.min(chunkSize-1, r0[0]));
                        const by = Math.max(0, Math.min(chunkSize-1, r0[1]));
                        const ex = Math.max(0, Math.min(chunkSize-1, r1[0]));
                        const ey = Math.max(0, Math.min(chunkSize-1, r1[1]));
                        const blockType = reg.block_type || 'stone';
                        // Check for rotation/invert in special metadata
                        const rot = reg.special && reg.special.rot !== undefined ? reg.special.rot : 0;
                        const invert = reg.special && reg.special.invert !== undefined ? reg.special.invert : false;
                        const hasTransform = rot !== 0 || invert !== false;
                        
                        for (let y = by; y <= ey; y++) {
                            for (let x = bx; x <= ex; x++) {
                                if (hasTransform) {
                                    arr[y * chunkSize + x] = { id: blockType, rot: rot, invert: invert };
                                } else {
                                    arr[y * chunkSize + x] = blockType;
                                }
                            }
                        }
                        
                        // Apply region-local specials (e.g., ores)
                        if (reg.special && reg.special.type === 'ores') {
                            const s = reg.special;
                            const spread = (s.data && s.data.spread) ? s.data.spread : [];
                            const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? this.noiseOptions.seed : 1337;
                            const pseudo = (a, x, y) => { const n = x * 374761393 + y * 668265263 + (a|0) * 1274126177; const v = Math.sin(n) * 43758.5453123; return v - Math.floor(v); };
                            for (let y = by; y <= ey; y++) {
                                for (let x = bx; x <= ex; x++) {
                                    const idx = y * chunkSize + x;
                                    const cur = arr[idx];
                                    if (typeof cur === 'string' && cur !== 'air') {
                                        for (let i = 0; i < spread.length; i++) {
                                            const sopt = spread[i];
                                            const chance = Number(sopt.chance || 0);
                                            const pick = sopt.block_type;
                                            const r = pseudo(seed + i * 2654435761, startX + x, startY + y);
                                            if (r < chance) { arr[idx] = pick; break; }
                                        }
                                    }
                                }
                            }
                        }
                    }
                } catch (e) { /* ignore region errors */ }
                
                chunk = { x: cx, y: cy, width: chunkSize, height: chunkSize, data: arr };
            }
        } else if (Array.isArray(data)) {
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
     * Draw visible tiles to the provided Draw instance.
     * - `draw`: the Draw instance with an active context (call `useCtx` before)
     * - `camera`: optional Camera instance (used to compute visible area). If
     *     provided, `camera.screenToWorld` is used to map screen -> world.
     * - `resources`: optional Map-like container created by AssetManager (keys
     *     are tilemap names -> TileSheet, and key 'blocks' -> Map of block metadata)
     * - `opts`: { tileSize } overrides sample->world tile size (defaults to noiseTileSize)
     */
    draw(draw, camera = null, resources = null, opts = {}) {
        if (!draw || !draw.ctx) return;
        const ctx = draw.ctx;
        const canvas = ctx.canvas;
        const tileSize = Number.isFinite(opts.tileSize) ? opts.tileSize : this.noiseTileSize;

        // Compute world-space rectangle for visible area
        let topLeft = { x: 0, y: 0 };
        let bottomRight = { x: 1920, y: 1080 };
        if (camera && typeof camera.screenToWorld === 'function') {
            topLeft = camera.screenToWorld({ x: 0, y: 0 });
            bottomRight = camera.screenToWorld({ x: 1920, y: 1080 });
        } else {
            // Convert pixel extents to world units using Draw.Scale
            topLeft = { x: 0, y: 0 };
            bottomRight = { x: 1920 / (draw.Scale.x || 1), y: 1080 / (draw.Scale.y || 1) };
        }

        const sx0 = Math.floor(topLeft.x / tileSize) - 1;
        const sy0 = Math.floor(topLeft.y / tileSize) - 1;
        const sx1 = Math.ceil(bottomRight.x / tileSize) + 1;
        const sy1 = Math.ceil(bottomRight.y / tileSize) + 1;

        // Helper to lookup TileSheet for a block id via resources or this.blockDefs
        const lookupTileSheet = (bid) => {
            if (!bid) return null;
            let meta = null;
            if (this.blockDefs && this.blockDefs instanceof Map) meta = this.blockDefs.get(bid);
            if ((!meta || !meta.texture) && resources && typeof resources.get === 'function') {
                // resources may contain a 'blocks' entry (map) with richer metadata
                try {
                    const rblocks = resources.get('blocks');
                    if (rblocks && rblocks instanceof Map && rblocks.has(bid)) meta = rblocks.get(bid);
                } catch (e) { /* ignore */ }
            }
            if (!meta || !meta.texture) return null;
            const tex = meta.texture;
            const tilemapName = tex.tilemap;
            if (!tilemapName) return null;
            try {
                if (resources && typeof resources.get === 'function') return resources.get(tilemapName);
                if (resources && resources[tilemapName]) return resources[tilemapName];
            } catch (e) { /* ignore */ }
            return null;
        };

        // Iterate visible sample coordinates and draw tiles
        for (let sy = sy0; sy <= sy1; sy++) {
            for (let sx = sx0; sx <= sx1; sx++) {
                const tile = this.getTileValue(sx, sy);
                if (!tile || !tile.id) continue;
                const bid = tile.id;
                const rot = tile.rot !== undefined ? tile.rot : 0;
                const invert = tile.invert !== undefined ? tile.invert : false;
                // Resolve tilesheet and draw using Draw.tile if available
                const ts = lookupTileSheet(bid);
                const pos = new Vector(sx * tileSize, sy * tileSize);

                // Compute brightness if lighting provided. Force full brightness for sunlit tiles (sy < 0).
                let brightness = 1;
                try {
                    if (sy < 0) {
                        brightness = 1.0;
                    } else {
                        brightness = opts.lighting.getBrightness(sx, sy);
                    }
                } catch (e) { brightness = 1; }
                // Apply brightness multiplier for subsequent draw calls
                draw.setBrightness(brightness);

                if (ts && ts.sheet) {
                    try {
                        // Convert rotation from degrees to integer steps (0-3)
                        // 0°=0, 90°=1, 180°=2, 270°=3
                        const rotSteps = Math.floor((rot % 360) / 90) % 4;
                        // Convert boolean invert to Vector for horizontal flip
                        const invertVec = invert ? new Vector(-1, 1) : null;
                        draw.tile(ts, pos, tileSize, bid, rotSteps, invertVec, 1, false);
                    } catch (e) {
                        // fallback to simple rect if tile draw fails
                        draw.rect(pos, new Vector(tileSize, tileSize), '#ff00ff88', false);
                    }
                } else {
                    // No TileSheet available: draw a placeholder rect. Use lighting to modulate color if possible.
                    let fillCol = '#ff00e1ff';
                    try {
                        if (opts.lighting && opts.lighting.constructor && typeof opts.lighting.constructor.modulateColor === 'function') {
                            fillCol = opts.lighting.constructor.modulateColor('#f700ffff', brightness);
                        }
                    } catch (e) { /* ignore */ }
                    draw.rect(pos, new Vector(tileSize, tileSize), fillCol, true);
                }

                // Reset brightness to default for next tile
                draw.setBrightness(1);
            }
        }
    }
}