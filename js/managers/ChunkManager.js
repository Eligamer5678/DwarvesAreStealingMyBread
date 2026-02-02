import { perlinNoise } from '../utils/noiseGen.js';
import Signal from '../modules/Signal.js';
import TileSheet from '../modules/Tilesheet.js';
import Vector from '../modules/Vector.js';
import Saver from './Saver.js';

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
    constructor(saver,options = {}) {
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
        this.entityManager = null;
        this.ready = false;
        this.saver = saver
        // Internal state
        // New chunk storage format: layer -> { "cx,cy": { tiles: [...], data: {...} } }
        this.chunks = { back: {}, base: {}, front: {} };
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
        // Autosave timer handle
        this._autosaveInterval = null;
        // Start autosave every minute if a Saver instance was provided
        try {
            if (this.saver && typeof this.saver === 'object') {
                this._autosaveInterval = setInterval(() => {
                    try { this.save(); } catch (e) { console.warn('ChunkManager autosave failed', e); }
                },30000);
            }
        } catch (e) {
            // ignore
        }
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

        // After the base JSON is loaded, expand any structure rules in
        // generation.json that reference external chunk files. This allows
        // entries like:
        //   {
        //     "type": "structure",
        //     "root": [0,0],
        //     "chunkFiles": ["exports/chunk_0_0.json", "exports/chunk_0_1.json"]
        //   }
        // or individual chunk entries with a `file` property. The files are
        // loaded here (once) and their specs cached on the chunk entries so
        // _generateChunkJSON can use them synchronously.
        try {
            await this._expandGenerationStructureFiles(basePath);
        } catch (e) {
            console.warn('ChunkManager.loadDefinitions: failed to expand structure files', e);
        }

        return { chunks: this.chunkSpecs, generation: this.generationSpec, blocks: this.blockDefs };
    }

    /**
     * Expand structure rules in generationSpec that reference external
     * chunk JSON files. Supports several patterns on a structure rule:
     *   - `chunkFiles: ["path/chunk_0_0.json", ...]` where positions are
     *     inferred from the JSON (pos) or from the filename ("*_x_y.json").
    *   - `chunkFiles: "exports/myVillage"` (string). In this case, the
    *     folder is treated as the base path. There are two ways to
    *     discover chunk files inside the folder:
    *       a) If `startPos: [sx, sy]` is present on the rule, a
    *          flood-fill is performed starting from
    *          `chunk_<sx>_<sy>.json`, walking 4-neighbour coordinates
    *          and only expanding through files that actually exist.
    *          This is efficient for arbitrary, non-rectangular shapes.
    *       b) Otherwise, files named `chunk_<x>_<y>.json` in a
    *          coordinate range are probed. The range can be customized
    *          via an optional `chunkFileRange` object on the rule:
    *            { "minX": -64, "maxX": 64, "minY": -16, "maxY": 16 }
    *          If `chunkFileRange` is omitted, a default range of
    *          [-64, 64] on X and [-16, 16] on Y is used.
     *   - `chunks: [{ pos:[x,y], file:"path/file.json" }, ...]` where
     *     positions are provided explicitly.
     *
     * Each referenced file is expected to either already look like a
     * single chunk spec from chunks.json ({ dependencies, data: { bg,
     * regions, entities? } }) or contain `{ regions, entities? }`, in
     * which case it is wrapped into that shape.
     */
    async _expandGenerationStructureFiles(basePath) {
        const gen = this.generationSpec;
        if (!gen || typeof gen !== 'object') return;

        const makeUrl = (rel) => {
            if (typeof rel !== 'string' || !rel) return null;
            // Absolute or fully qualified URLs are used as-is
            if (/^https?:\/\//i.test(rel) || rel.startsWith('/')) return rel;
            // Otherwise, treat as relative to the data/ folder
            return `${basePath}/${rel.replace(/^\.\//, '')}`;
        };

        const loadChunkSpecFromFile = async (fp) => {
            const url = makeUrl(fp);
            if (!url) return null;
            try {
                const resp = await fetch(url, { cache: 'no-cache' });
                if (!resp.ok) {
                    //onsole.warn('expandStructureFiles: failed to fetch', url, resp.status);
                    return null;
                }
                const js = await resp.json();

                // If it already looks like a chunk spec from chunks.json
                if (js && js.data && Array.isArray(js.data.regions)) {
                    return {
                        dependencies: Array.isArray(js.dependencies) ? js.dependencies.slice() : [],
                        data: js.data
                    };
                }

                // If it's a bare `{ regions, entities? }` like the internal
                // save format, wrap it into a chunk spec.
                if (js && Array.isArray(js.regions)) {
                    return {
                        dependencies: [],
                        data: {
                            bg: 'air',
                            regions: js.regions,
                            entities: Array.isArray(js.entities) ? js.entities : undefined
                        }
                    };
                }

                // If it looks like a miniature chunks.json, try to pull out
                // the first concrete chunk spec ({ data: { regions } }).
                if (js && js.chunks && typeof js.chunks === 'object') {
                    for (const k of Object.keys(js.chunks)) {
                        const container = js.chunks[k];
                        if (!container || typeof container !== 'object') continue;
                        for (const ck of Object.keys(container)) {
                            const spec = container[ck];
                            if (spec && spec.data && Array.isArray(spec.data.regions)) {
                                return {
                                    dependencies: Array.isArray(spec.dependencies) ? spec.dependencies.slice() : [],
                                    data: spec.data
                                };
                            }
                        }
                    }
                }

                console.warn('expandStructureFiles: unrecognized chunk JSON shape for', url);
                return null;
            } catch (e) {
                console.warn('expandStructureFiles: error loading', url, e);
                return null;
            }
        };

        const inferPosFromName = (fp) => {
            if (typeof fp !== 'string') return null;
            const bn = fp.split('/').pop() || fp;
            const name = bn.replace(/\.json$/i, '');
            // Accept patterns ending in "_x_y" (e.g., "chunk_0_1").
            const m = name.match(/(-?\d+)_(-?\d+)$/);
            if (!m) return null;
            const x = Number(m[1]);
            const y = Number(m[2]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return [x, y];
        };

        for (const key of Object.keys(gen)) {
            const rule = gen[key];
            if (!rule || rule.type !== 'structure') continue;

            // 1) Handle `chunkFiles` on the rule.
            //    a) If it's an array, treat each entry as a file path.
            //    b) If it's a string, treat as a folder containing
            //       `chunk_<x>_<y>.json` files in a coordinate range.
            const fileList = Array.isArray(rule.chunkFiles) ? rule.chunkFiles : [];
            const folder = (!Array.isArray(rule.chunkFiles) && typeof rule.chunkFiles === 'string') ? rule.chunkFiles : null;

            // 1a) Explicit list of files
            if (fileList.length > 0) {
                if (!Array.isArray(rule.chunks)) rule.chunks = [];
                for (const fp of fileList) {
                    const spec = await loadChunkSpecFromFile(fp);
                    if (!spec) continue;

                    let pos = null;
                    if (Array.isArray(spec.pos) && spec.pos.length === 2) {
                        pos = [Number(spec.pos[0]) || 0, Number(spec.pos[1]) || 0];
                    } else {
                        pos = inferPosFromName(fp);
                    }
                    if (!pos) {
                        console.warn('expandStructureFiles: could not infer pos for', fp);
                        continue;
                    }

                    const entry = { pos: pos, type: ['__inline__'], file: fp };
                    // Cache the resolved chunk spec directly on the entry
                    entry._inlineSpec = spec;
                    rule.chunks.push(entry);
                }
            }

            // 1b) Folder-based auto discovery using either flood-fill
            //     (when `startPos` is provided) or a rectangular probe
            //     range (when it is not).
            if (folder && typeof folder === 'string') {
                if (!Array.isArray(rule.chunks)) rule.chunks = [];

                const startPos = (Array.isArray(rule.startPos) && rule.startPos.length === 2
                    && Number.isFinite(Number(rule.startPos[0]))
                    && Number.isFinite(Number(rule.startPos[1])))
                    ? [Number(rule.startPos[0]), Number(rule.startPos[1])] : null;

                if (startPos) {
                    // Flood-fill: explore only coordinates reachable from
                    // startPos via 4-neighbour steps where a corresponding
                    // `chunk_<x>_<y>.json` file exists.
                    const visited = new Set();
                    const q = [];
                    const normFolder = folder.replace(/\/$/, '');

                    const enqueue = (x, y) => {
                        const k = `${x},${y}`;
                        if (visited.has(k)) return;
                        visited.add(k);
                        q.push([x, y]);
                    };

                    enqueue(startPos[0], startPos[1]);

                    while (q.length > 0) {
                        const [cx, cy] = q.shift();
                        const fp = `${normFolder}/chunk_${cx}_${cy}.json`;
                        const spec = await loadChunkSpecFromFile(fp);
                        if (!spec) continue; // do not expand from missing files

                        // Avoid duplicating existing entries for this pos
                        let already = false;
                        for (const c of (rule.chunks || [])) {
                            if (!c || !Array.isArray(c.pos)) continue;
                            const ex = Number(c.pos[0]);
                            const ey = Number(c.pos[1]);
                            if (ex === cx && ey === cy) { already = true; break; }
                        }
                        if (!already) {
                            const entry = { pos: [cx, cy], type: ['__inline__'], file: fp };
                            entry._inlineSpec = spec;
                            rule.chunks.push(entry);
                        }

                        // 4-neighbour expansion
                        enqueue(cx + 1, cy);
                        enqueue(cx - 1, cy);
                        enqueue(cx, cy + 1);
                        enqueue(cx, cy - 1);
                    }
                } else {
                    // Rectangular probe as a fallback when no startPos is
                    // provided. This maintains backwards compatibility.
                    const range = (rule.chunkFileRange && typeof rule.chunkFileRange === 'object')
                        ? rule.chunkFileRange
                        : { minX: -64, maxX: 64, minY: -16, maxY: 16 };

                    const minX = Number.isFinite(range.minX) ? range.minX : -64;
                    const maxX = Number.isFinite(range.maxX) ? range.maxX : 64;
                    const minY = Number.isFinite(range.minY) ? range.minY : -16;
                    const maxY = Number.isFinite(range.maxY) ? range.maxY : 16;

                    // Track which positions we've already added to avoid
                    // duplicates if chunkFiles also contained explicit entries.
                    const existing = new Set();
                    for (const c of (rule.chunks || [])) {
                        if (!c || !Array.isArray(c.pos)) continue;
                        const ex = Number(c.pos[0]);
                        const ey = Number(c.pos[1]);
                        if (Number.isFinite(ex) && Number.isFinite(ey)) {
                            existing.add(`${ex},${ey}`);
                        }
                    }

                    const normFolder = folder.replace(/\/$/, '');
                    for (let y = minY; y <= maxY; y++) {
                        for (let x = minX; x <= maxX; x++) {
                            const keyPos = `${x},${y}`;
                            if (existing.has(keyPos)) continue;
                            const fp = `${normFolder}/chunk_${x}_${y}.json`;
                            const spec = await loadChunkSpecFromFile(fp);
                            if (!spec) continue; // silently skip missing ones

                            const entry = { pos: [x, y], type: ['__inline__'], file: fp };
                            entry._inlineSpec = spec;
                            rule.chunks.push(entry);
                            existing.add(keyPos);
                        }
                    }
                }
            }

            // 2) Handle explicit `chunks: [{ pos, file }, ...]` entries.
            if (!Array.isArray(rule.chunks)) continue;
            for (const c of rule.chunks) {
                if (!c || typeof c.file !== 'string') continue;
                if (c._inlineSpec) continue; // already processed above

                const spec = await loadChunkSpecFromFile(c.file);
                if (!spec) continue;
                c._inlineSpec = spec;

                // If pos is missing on the chunk entry, try from spec or name.
                if (!Array.isArray(c.pos)) {
                    if (Array.isArray(spec.pos) && spec.pos.length === 2) {
                        c.pos = [Number(spec.pos[0]) || 0, Number(spec.pos[1]) || 0];
                    } else {
                        const p = inferPosFromName(c.file);
                        if (p) c.pos = p;
                    }
                }
            }
        }
    }

    /**
     * Generate chunks around a world position
     * @param {number} worldX - World X coordinate
     * @param {number} worldY - World Y coordinate
     * @param {number} radius - Chunk radius to generate
     */
    generateChunksAround(worldX, worldY, radius = 1) {
        if(!this.ready)return;
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
    getTileValue(sx, sy, layer = 'base') {
        if (!Number.isFinite(sx) || !Number.isFinite(sy)) return null;

        // No longer use `modifiedTiles`; all modifications are written directly
        // into the per-layer chunk `tiles` arrays (chunkEntry.data.modified).

        // Check explicit block placements
        const mkey = `${sx},${sy},${layer}`;
        if (this.blockMap.has(mkey)) {
            const bm = this.blockMap.get(mkey);
            // blockMap entries are assumed to be base-layer by default
            return Object.assign({ layer: (bm.layer || 'base') }, bm);
        }

        // Query chunk data per-layer. We'll compute chunk coords and index
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const key = this._chunkKey(cx, cy);
        const lx = sx - cx * this.chunkSize;
        const ly = sy - cy * this.chunkSize;
        if (lx < 0 || ly < 0 || lx >= this.chunkSize || ly >= this.chunkSize) return null;

        const readRawFromLayer = (ln) => {
            const bucket = this.chunks[ln] || {};
            let entry = bucket[key];
            if (!entry) {
                // ensure generation so missing layers get created
                this._ensureChunk(cx, cy);
                entry = (this.chunks[ln] || {})[key];
            }
            if (!entry) return null;
            const width = entry.data && entry.data.width ? entry.data.width : this.chunkSize;
            const idx = ly * width + lx;
            if (!entry.tiles || idx < 0 || idx >= entry.tiles.length) return null;
            return entry.tiles[idx];
        };

        const processRaw = (raw, tileLayer) => {
            if (raw === null || raw === 'air' || raw === '') return null;
            if (typeof raw === 'string') {
                try {
                    const def = (this.blockDefs && this.blockDefs instanceof Map) ? this.blockDefs.get(raw) : null;
                    const mode = def && def.data && def.data.mode ? def.data.mode : 'solid';
                    if (layer !== 'any' && tileLayer !== layer) return null;
                    return { type: mode || 'solid', id: raw, meta: def || null, layer: tileLayer };
                } catch (e) {
                    if (layer !== 'any' && tileLayer !== layer) return null;
                    return { type: 'solid', id: raw, layer: tileLayer };
                }
            }
            if (typeof raw === 'object' && raw !== null && raw.id) {
                if (raw.id === 'air' || raw.id === '') return null;
                try {
                    const def = (this.blockDefs && this.blockDefs instanceof Map) ? this.blockDefs.get(raw.id) : null;
                    const mode = def && def.data && def.data.mode ? def.data.mode : 'solid';
                    const tileL = (raw.layer || tileLayer);
                    if (layer !== 'any' && tileL !== layer) return null;
                    return { type: mode, id: raw.id, meta: def || null, rot: raw.rot !== undefined ? raw.rot : 0, invert: raw.invert !== undefined ? raw.invert : false, layer: tileL };
                } catch (e) {
                    const tileL = (raw.layer || tileLayer);
                    if (layer !== 'any' && tileL !== layer) return null;
                    return { type: 'solid', id: raw.id, rot: raw.rot || 0, invert: raw.invert || false, layer: tileL };
                }
            }
            if (typeof raw === 'number' && raw < 0.999) return { type: 'solid' };
            return null;
        };

        if (layer === 'any') {
            const order = ['front','base','back'];
            for (const ln of order) {
                const raw = readRawFromLayer(ln);
                const t = processRaw(raw, ln);
                if (t) return t;
            }
            return null;
        }

        // specific layer requested
        const raw = readRawFromLayer(layer);
        return processRaw(raw, layer);
    }

    /**
     * Set a tile to a specific value (mining, placing, etc.)
     * @param {number} sx - Sample X coordinate
     * @param {number} sy - Sample Y coordinate
     * @param {String|Object|null} value - Tile data or null for empty
     */
    setTileValue(sx, sy, value, layer = 'base') {
        const mkey = `${sx},${sy},${layer}`;


        // Update chunk data if already generated (ensure target layer bucket exists)
        const cx = Math.floor(sx / this.chunkSize);
        const cy = Math.floor(sy / this.chunkSize);
        const ckey = this._chunkKey(cx, cy);

        // Try to find or create an entry for the requested layer
        if (!this.chunks[layer]) this.chunks[layer] = {};
        let chunkEntry = this.chunks[layer][ckey];

        // If no chunk entry for the requested layer, try to find any existing
        // chunk for this coordinate and create the layer entry from it.
        if (!chunkEntry) {
            for (const ln of Object.keys(this.chunks)) {
                const b = this.chunks[ln];
                if (b && b[ckey]) {
                    // create empty layer entry if missing
                    const width = b[ckey].data && b[ckey].data.width ? b[ckey].data.width : this.chunkSize;
                    const tiles = new Array(width * (b[ckey].data.height || this.chunkSize)).fill('air');
                    // copy nothing by default; keep existing layer data untouched
                    this.chunks[layer][ckey] = { tiles: tiles, data: { modified: false, x: cx, y: cy, width: width, height: b[ckey].data.height || this.chunkSize, layer: layer } };
                    chunkEntry = this.chunks[layer][ckey];
                    break;
                }
            }
        }

        // If still no entry, attempt to generate chunk (this will populate layer buckets)
        if (!chunkEntry) {
            this._ensureChunk(cx, cy);
            chunkEntry = (this.chunks[layer] || {})[ckey];
            if (!chunkEntry) {
                // create a fresh empty layer entry
                const tiles = new Array(this.chunkSize * this.chunkSize).fill('air');
                this.chunks[layer][ckey] = { tiles: tiles, data: { modified: false, x: cx, y: cy, width: this.chunkSize, height: this.chunkSize, layer: layer } };
                chunkEntry = this.chunks[layer][ckey];
            }
        }

        if (chunkEntry) {
            const lx = sx - cx * this.chunkSize;
            const ly = sy - cy * this.chunkSize;
            const width = chunkEntry.data.width || this.chunkSize;
            const height = chunkEntry.data.height || this.chunkSize;
            if (lx >= 0 && ly >= 0 && lx < width && ly < height) {
                // Write block ids into the JSON-driven chunk tiles array.
                let out;
                if (value === null) out = 'air';
                else if (typeof value === 'string') out = value;
                else if (typeof value === 'object' && value.id) {
                    out = { id: value.id };
                    if (value.rot !== undefined) out.rot = value.rot;
                    if (value.invert !== undefined) out.invert = value.invert;
                } else out = 'stone';
                chunkEntry.tiles[ly * width + lx] = out;
                // mark chunk as modified
                if (chunkEntry.data) chunkEntry.data.modified = true;
            }
        }

        this.onTileModified.emit(sx, sy, value, layer);
    }

    /**
     * Get all chunks
     * @returns {Map} The chunks map
     */
    getChunks() {
        return this.chunks;
    }

    /**
     * Get a single chunk by chunk coordinates. Will generate the chunk if missing.
     * @param {number} cx Chunk X coordinate
     * @param {number} cy Chunk Y coordinate
     * @returns {Object|null} Chunk object or null
     */
    getChunk(cx, cy) {
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
        return this._ensureChunk(cx, cy);
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
        // Check existing stored chunks across layers. If multiple per-layer
        // entries exist for this chunk, return a `data` object mapping each
        // present layer to its tiles array so callers (like sortChunk)
        // can inspect all layers. If only a single layer entry exists, keep
        // the legacy behavior of returning its tiles array directly.
        const layers = ['back', 'base', 'front'];
        let foundAny = false;
        const dataObj = {};
        let foundWidth = null;
        let foundHeight = null;
        for (const l of layers) {
            const bucket = this.chunks[l];
            if (bucket && Object.prototype.hasOwnProperty.call(bucket, key)) {
                const entry = bucket[key];
                foundAny = true;
                dataObj[l] = entry.tiles;
                if (foundWidth === null) {
                    foundWidth = entry.data.width || this.chunkSize;
                    foundHeight = entry.data.height || this.chunkSize;
                }
            }
        }
        if (foundAny) {
            // prefer returning a full per-layer object when multiple layers
            // are present; otherwise return the single tiles array for
            // backward compatibility.
            const layerKeys = Object.keys(dataObj);
            const defaultLayer = (dataObj.base) ? 'base' : layerKeys[0];
            const retData = (layerKeys.length === 1) ? dataObj[defaultLayer] : dataObj;
            return { x: cx, y: cy, width: foundWidth || this.chunkSize, height: foundHeight || this.chunkSize, data: retData, layer: defaultLayer };
        }

        // Always use JSON-driven generation. If there are no definitions,
        // _generateChunkJSON will return an empty 'air' chunk.
        const chunk = this._generateChunkJSON(cx, cy);
        const layer = chunk.layer || 'base';
        // chunk.data may be a per-layer object or a single array. Normalize storage
        if (chunk && chunk.data && typeof chunk.data === 'object' && !Array.isArray(chunk.data)) {
            for (const ln of Object.keys(chunk.data)) {
                if (!this.chunks[ln]) this.chunks[ln] = {};
                this.chunks[ln][key] = { tiles: chunk.data[ln], data: { modified: false, x: cx, y: cy, width: chunk.width, height: chunk.height, layer: ln } };
            }
        } else {
            if (!this.chunks[layer]) this.chunks[layer] = {};
            this.chunks[layer][key] = { tiles: chunk.data, data: { modified: false, x: cx, y: cy, width: chunk.width, height: chunk.height, layer: layer } };
        }
        this.onChunkGenerated.emit(cx, cy, chunk);
        return chunk;
    }

    /**
     * Resolve a chunk spec by name, supporting grouped keys in brackets.
     * If the referenced spec is a container (no .data) but contains child
     * entries and/or nested groups, pick one child deterministically based
     * on chunk coordinates so generation remains repeatable.
     */
    _resolveChunkSpec(name, cx, cy) {
        if (!name || typeof name !== 'string') return null;
        // direct lookup in chunks map
        const chunks = this.chunkSpecs && this.chunkSpecs.chunks ? this.chunkSpecs.chunks : null;
        const direct = chunks && chunks[name] ? chunks[name] : null;
        // If direct spec exists and looks like a real chunk spec (has .data), return it
        if (direct && typeof direct === 'object' && direct.data) return direct;

        // If not found directly, search bracketed/group containers for a child
        if (chunks) {
            for (const k of Object.keys(chunks)) {
                try {
                    const container = chunks[k];
                    if (!container || typeof container !== 'object') continue;
                    // If container has the named child, prefer that
                    if (Object.prototype.hasOwnProperty.call(container, name)) {
                        const child = container[name];
                        if (child && typeof child === 'object' && child.data) return child;
                        // if child exists but is a container of named children, try to pick one deterministically
                        if (child && typeof child === 'object') {
                            const candidates = [];
                            for (const kk of Object.keys(child)) {
                                const v = child[kk];
                                if (v && typeof v === 'object' && v.data) candidates.push(v);
                            }
                            if (candidates.length === 1) return candidates[0];
                            if (candidates.length > 1) {
                                const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? this.noiseOptions.seed : 1337;
                                const startX = cx * this.chunkSize; const startY = cy * this.chunkSize;
                                const n = startX * 374761393 + startY * 668265263 + (seed|0) * 1274126177;
                                const v = Math.sin(n) * 43758.5453123;
                                let r = v - Math.floor(v);
                                const idx = Math.floor(r * candidates.length) % candidates.length;
                                return candidates[idx];
                            }
                        }
                    }
                } catch (e) { /* ignore container errors */ }
            }
        }

        // If name is bracketed like "[group]", try to find the group object
        let groupKey = name;
        if (groupKey.startsWith('[') && groupKey.endsWith(']')) {
            // prefer the bracketed key in chunks map
            if (chunks && chunks[groupKey]) {
                const container = chunks[groupKey];
                // collect candidate specs
                const candidates = [];
                for (const k of Object.keys(container)) {
                    try {
                        // if key looks like a subgroup (bracketed), recurse by that key
                        if (k.startsWith('[') && k.endsWith(']')) {
                            const sub = this._resolveChunkSpec(k, cx, cy);
                            if (sub) candidates.push(sub);
                        } else {
                            // if there's an inline spec object
                            const val = container[k];
                            if (val && typeof val === 'object' && val.data) candidates.push(val);
                            // or if a named chunk exists in global chunks, use that
                            else if (chunks && chunks[k]) candidates.push(chunks[k]);
                        }
                    } catch (e) { /* ignore individual child errors */ }
                }
                if (candidates.length === 1) return candidates[0];
                if (candidates.length > 1) {
                    // pick deterministically using chunk coords and seed
                    const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? this.noiseOptions.seed : 1337;
                    const startX = cx * this.chunkSize; const startY = cy * this.chunkSize;
                    const n = startX * 374761393 + startY * 668265263 + (seed|0) * 1274126177;
                    const v = Math.sin(n) * 43758.5453123;
                    let r = v - Math.floor(v);
                    const idx = Math.floor(r * candidates.length) % candidates.length;
                    return candidates[idx];
                }
            }
        }

        // fallback: if direct exists but lacked .data, maybe it's a map of named children
        if (direct && typeof direct === 'object') {
            const container = direct;
            const candidates = [];
            for (const k of Object.keys(container)) {
                try {
                    if (k.startsWith('[') && k.endsWith(']')) {
                        const sub = this._resolveChunkSpec(k, cx, cy);
                        if (sub) candidates.push(sub);
                    } else {
                        const val = container[k];
                        if (val && typeof val === 'object' && val.data) candidates.push(val);
                        else if (chunks && chunks[k]) candidates.push(chunks[k]);
                    }
                } catch (e) { }
            }
            if (candidates.length === 1) return candidates[0];
            if (candidates.length > 1) {
                const seed = (this.noiseOptions && Number.isFinite(this.noiseOptions.seed)) ? this.noiseOptions.seed : 1337;
                const startX = cx * this.chunkSize; const startY = cy * this.chunkSize;
                const n = startX * 374761393 + startY * 668265263 + (seed|0) * 1274126177;
                const v = Math.sin(n) * 43758.5453123;
                let r = v - Math.floor(v);
                const idx = Math.floor(r * candidates.length) % candidates.length;
                return candidates[idx];
            }
        }

        return direct;
    }

    /**
     * Generate a chunk using the JSON-driven specs (chunks.json + generation.json)
     */
    _generateChunkJSON(cx, cy) {
        const chunkSize = this.chunkSize;
        const startX = cx * chunkSize;
        const startY = cy * chunkSize;

        
        // First, check for JSON-driven "structure" rules. Structures declare
        // a `root` chunk coordinate and an array of `chunks` with positions
        // relative to that root. If the current chunk coordinates fall inside
        // a structure, select the corresponding chunk type.
        // Note: roots/positions are expressed in chunk coordinates (e.g.
        // [1,1] corresponds to tile origin [16,16] when chunkSize==16).
        let selected = null;
        if (this.generationSpec && typeof this.generationSpec === 'object') {
            for (const key of Object.keys(this.generationSpec)) {
                const rule = this.generationSpec[key];
                if (rule && rule.type === 'structure' && Array.isArray(rule.root) && Array.isArray(rule.chunks)) {
                    const root = rule.root; // [rx, ry] in chunk coords
                    const rx = Number(root[0] || 0);
                    const ry = Number(root[1] || 0);
                    const relX = cx - rx;
                    const relY = cy - ry;
                    for (const c of rule.chunks) {
                        if (!c || !Array.isArray(c.pos)) continue;
                        const px = Number(c.pos[0] || 0);
                        const py = Number(c.pos[1] || 0);
                        if (px === relX && py === relY) {
                            // Found a matching structure chunk. Use its `type`.
                            selected = { chunk_type: null, chunk_types: null, _structChunk: c };
                            // capture optional invert flag on the structure chunk entry
                            // expected form: "invert": [1|-1, 1|-1]
                            let inv = null;
                            if(c.invert){
                                const ix = Number(c.invert[0]) === -1 ? -1 : 1;
                                const iy = Number(c.invert[1]) === -1 ? -1 : 1;
                                inv = [ix, iy];
                            }
                            selected._invert = inv;
                            // Normalize various shapes of `type` on the chunk entry
                            if (typeof c.type === 'string') selected.chunk_type = c.type;
                            else if (Array.isArray(c.type) && c.type.length > 0) selected.chunk_type = c.type[0];
                            else if (c.type && typeof c.type === 'object' && c.type.name) selected.chunk_type = c.type.name;
                            else selected.chunk_type = null;
                            break;
                        }
                    }
                    // do not break here; allow later structure rules to override earlier ones
                    // (keep iterating to allow last-match to win)
                }
            }
        }

        // If no structure matched, fall back to condition-based selection
        if (!selected && this.generationSpec && typeof this.generationSpec === 'object') {
            // Evaluate all generation rules and let the last matching rule win
            for (const key of Object.keys(this.generationSpec)) {
                const rule = this.generationSpec[key];
                const conds = rule.conditions || [];
                if (this._matchesGenerationConditions(conds, cx, cy)) { selected = rule; }
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
        // Prepare per-layer tile arrays. Each layer holds its own tiles so
        // multiple tiles can exist at the same coordinates.
        const layers = { back: new Array(chunkSize * chunkSize).fill('air'), base: new Array(chunkSize * chunkSize).fill('air'), front: new Array(chunkSize * chunkSize).fill('air') };

        // Resolve chunk spec either from the global chunks.json definitions
        // or from an inline spec attached to a structure chunk entry
        // (populated by _expandGenerationStructureFiles when generation.json
        // references external chunk files).
        let spec = this._resolveChunkSpec(chunkType, cx, cy);
        if ((!spec || !spec.data) && selected && selected._structChunk && selected._structChunk._inlineSpec) {
            spec = selected._structChunk._inlineSpec;
        }
        if (!spec) {
            // No spec available: return default empty per-layer chunk (all 'air').
            const outChunk = { x: cx, y: cy, width: chunkSize, height: chunkSize, layer: 'base', data: layers };
            return outChunk;
        }
        // Fill the chunk-level background into its declared layer
        const layerForChunk = (spec.data && spec.data.layer) ? spec.data.layer : 'base';
        if (spec.data && spec.data.bg !== undefined) {
            const bg = spec.data.bg;
            const target = layers[layerForChunk] || layers.base;
            for (let i = 0; i < target.length; i++) target[i] = bg;
        }
        
        // Fill regions
        // Support `copyfrom` in chunk specs: copy regions from another named
        // chunk spec before applying this spec's regions. This allows small
        // variants to reuse a base chunk layout.
        const resolveCopiedRegions = (name, seen = new Set()) => {
            if (!name || typeof name !== 'string') return [];
            if (name === 'none') return [];
            if (!this.chunkSpecs || !this.chunkSpecs.chunks) return [];
            if (seen.has(name)) return [];
            seen.add(name);
            const s = this.chunkSpecs.chunks[name];
            if (!s || !s.data) return [];
            // first, recursively resolve copyfrom on the source so chains work
            const parentCopy = (s.data.copyfrom && typeof s.data.copyfrom === 'string') ? resolveCopiedRegions(s.data.copyfrom, seen) : [];
            const srcRegions = Array.isArray(s.data.regions) ? s.data.regions.map(r => JSON.parse(JSON.stringify(r))) : [];
            return parentCopy.concat(srcRegions);
        };

        let regions = [];
        let _savedOverrode = false;
        if (spec.data && typeof spec.data.copyfrom === 'string' && spec.data.copyfrom !== 'none') {
            regions = regions.concat(resolveCopiedRegions(spec.data.copyfrom));
        }
        // then append this spec's own regions (so they can override/extend)
        // Deep-copy region objects to avoid shared references between specs
        if (spec.data && Array.isArray(spec.data.regions)) regions = regions.concat(spec.data.regions.map(r => JSON.parse(JSON.stringify(r))));

        // If a saved chunk exists in the Saver, prefer its regions to override
        // the generation spec. This allows loading previously saved edits.
        const saved = this.saver.get(`chunks/${cx},${cy}`, null);
        if (saved && Array.isArray(saved.regions)) {
            regions = saved.regions;
            _savedOverrode = true;
        }

        // If this chunk came from a structure and an `invert` directive was
        // provided on the structure chunk entry, transform the generation
        // regions' coordinates accordingly. Do not modify saved user regions.
        try {
            const inv = (selected && selected._invert) ? selected._invert : null;
            if (inv && !_savedOverrode && Array.isArray(regions) && regions.length > 0) {
                // operate on a deep copy to avoid mutating canonical specs
                regions = regions.map(r => JSON.parse(JSON.stringify(r)));
                const ix = Number(inv[0]) === -1 ? -1 : 1;
                const iy = Number(inv[1]) === -1 ? -1 : 1;
                for (const reg of regions) {
                    if (!reg || !reg.region) continue;
                    const r0 = reg.region[0] ? reg.region[0] : [0,0];
                    const r1 = reg.region[1] ? reg.region[1] : reg.region[0] ? reg.region[0] : [r0[0], r0[1]];
                    const x0 = Number(r0[0] || 0);
                    const y0 = Number(r0[1] || 0);
                    const x1 = Number(r1[0] || x0);
                    const y1 = Number(r1[1] || y0);
                    let nx0 = x0, ny0 = y0, nx1 = x1, ny1 = y1;
                    if (ix === -1) {
                        nx0 = (chunkSize - 1) - x1;
                        nx1 = (chunkSize - 1) - x0;
                    }
                    if (iy === -1) {
                        ny0 = (chunkSize - 1) - y1;
                        ny1 = (chunkSize - 1) - y0;
                    }
                    // ensure ints and clamp
                    nx0 = Math.max(0, Math.min(chunkSize - 1, Math.floor(nx0)));
                    ny0 = Math.max(0, Math.min(chunkSize - 1, Math.floor(ny0)));
                    nx1 = Math.max(0, Math.min(chunkSize - 1, Math.floor(nx1)));
                    ny1 = Math.max(0, Math.min(chunkSize - 1, Math.floor(ny1)));
                    reg.region = [[nx0, ny0], [nx1, ny1]];
                }
            }
        } catch (e) { /* ignore invert errors */ }

        // Allow compact region specs to inherit certain fields from the
        // previous region. Only `block_type`, `special.rot`/`special.invert`,
        // and `layer` are inherited when not explicitly provided.
        let prevBlockType = null;
        let prevRot = 0;
        let prevInvert = false;
        let prevLayer = undefined;
        for (const reg of regions) {
            const r0 = reg.region && reg.region[0] ? reg.region[0] : [0,0];
            const r1 = reg.region && reg.region[1] ? reg.region[1] : reg.region[0];
            const bx = Math.max(0, Math.min(chunkSize-1, r0[0]));
            const by = Math.max(0, Math.min(chunkSize-1, r0[1]));
            const ex = Math.max(0, Math.min(chunkSize-1, r1[0]));
            const ey = Math.max(0, Math.min(chunkSize-1, r1[1]));
            // Inherit block_type if not present
            const blockType = (reg.block_type !== undefined && reg.block_type !== null) ? reg.block_type : (prevBlockType || 'stone');
            // Inherit rot/invert from previous region if not provided
            let rot = (reg.special && reg.special.rot !== undefined) ? reg.special.rot : prevRot;
            // Capture the region's original invert (either explicit or inherited)
            const baseInvert = (reg.special && reg.special.invert !== undefined) ? !!reg.special.invert : !!prevInvert;
            let invert = baseInvert;

            // If this chunk was selected from a structure with an _invert
            // directive, adjust rot/invert for block types that require it.
            try {
                const structInv = (selected && selected._invert) ? selected._invert : null;
                if (structInv && this.blockDefs) {
                    const ix = Number(structInv[0]) === -1;
                    const iy = Number(structInv[1]) === -1;
                    const bdef = (this.blockDefs && typeof this.blockDefs.get === 'function') ? this.blockDefs.get(blockType) : null;
                    const requireInvert = bdef && (bdef.requireInvert === true);
                    if (requireInvert && (ix || iy)) {
                        // Apply a consistent flip relative to the region's original invert
                        invert = !baseInvert;
                    }
                }
            } catch (e) { /* ignore block-def transform errors */ }

            const hasTransform = rot !== 0 || invert !== false;
            // Inherit layer from previous region when not set on this region
            const layerVal = (reg.layer !== undefined) ? reg.layer : prevLayer;

            for (let y = by; y <= ey; y++) {
                for (let x = bx; x <= ex; x++) {
                    const idx = y * chunkSize + x;
                    const tlayer = layerVal || layerForChunk || 'base';

                    // Honor `replace` lists on a per-region basis.
                    // If `reg.replace` is present and is an array, only replace
                    // the existing tile when the current tile id matches one of
                    // the entries. The special token "all" will cause an
                    // unconditional replace (matching legacy behavior).
                    let allowReplace = true;
                    if (reg.replace && Array.isArray(reg.replace)) {
                        const repl = reg.replace;
                        if (repl.indexOf('all') >= 0) {
                            allowReplace = true;
                        } else {
                            const cur = layers[tlayer][idx];
                            let curId = null;
                            if (cur === null || cur === undefined) curId = 'air';
                            else if (typeof cur === 'object' && cur.id) curId = cur.id;
                            else if (typeof cur === 'string') curId = cur;
                            else curId = String(cur);
                            allowReplace = repl.indexOf(curId) >= 0;
                        }
                    }

                    if (!allowReplace) continue;

                    if (hasTransform) {
                        const obj = { id: blockType, rot: rot, invert: invert };
                        layers[tlayer][idx] = obj;
                    } else {
                        layers[tlayer][idx] = blockType;
                    }
                }
            }

            // Update previous values for next region
            prevBlockType = blockType;
            prevRot = rot;
            // For inheritance, keep the original (base) invert value so
            // subsequent regions inherit the spec's original chain and are
            // not affected by structure-applied flips (prevents alternating flips).
            prevInvert = baseInvert;
            prevLayer = layerVal;
        }
        // Spawn entities defined by the generation spec or by a saved chunk override.
        try {
            // Merge saved entities with spec entities. Saved entries replace
            // same-type + same-pos spec entries; otherwise they are appended.
            const specEntities = (spec && spec.data && Array.isArray(spec.data.entities)) ? spec.data.entities.slice() : [];
            const savedEntities = (saved && Array.isArray(saved.entities)) ? saved.entities : [];

            const merged = specEntities.slice();
            for (const se of savedEntities) {
                if (!se) continue;
                let replaced = false;
                for (let i = 0; i < merged.length; i++) {
                    const me = merged[i];
                    if (!me || !me.type || !se.type) continue;
                    if (me.type !== se.type) continue;
                    // compare positions: either both 'random' or both arrays with equal coords
                    if (me.pos === 'random' && se.pos === 'random') { merged[i] = se; replaced = true; break; }
                    if (Array.isArray(me.pos) && Array.isArray(se.pos) && me.pos.length === 2 && se.pos.length === 2) {
                        const mx = Number(me.pos[0]); const my = Number(me.pos[1]);
                        const sx = Number(se.pos[0]); const sy = Number(se.pos[1]);
                        if (Number.isFinite(mx) && Number.isFinite(my) && mx === sx && my === sy) { merged[i] = se; replaced = true; break; }
                    }
                }
                if (!replaced) merged.push(se);
            }

            const entityList = (merged.length > 0) ? merged : null;
            if (entityList && Array.isArray(entityList)){
                for (let entity of entityList){
                    if(!entity) continue;
                    try {
                        // One-time locks: if this lock/key has already been used,
                        // do not respawn it from chunk specs/saved overrides.
                        try {
                            if ((entity.type === 'lock' || entity.type === 'key') && this.saver && typeof this.saver.isLockUsed === 'function') {
                                const meta = (entity && entity.data && typeof entity.data === 'object') ? entity.data : {};
                                const compMeta = (meta.components && typeof meta.components === 'object') ? (meta.components.LockComponent || meta.components.lock || null) : null;

                                // Prefer explicit per-entity metadata (for multiple locks).
                                const explicitLockKey = compMeta && typeof compMeta === 'object'
                                    ? (compMeta.lockId || compMeta.thisId || compMeta.keyId || null)
                                    : null;

                                // Otherwise, read the prefab defaults from entityTypes.
                                let prefabLockKey = null;
                                try {
                                    const preset = this.entityManager && this.entityManager.entityTypes ? this.entityManager.entityTypes.get(entity.type) : null;
                                    const lc = preset && typeof preset.getComponent === 'function' ? (preset.getComponent('LockComponent') || preset.getComponent('lock')) : null;
                                    if (lc) prefabLockKey = lc.lockId || lc.thisId || lc.keyId || null;
                                } catch (e) {}

                                const lockKey = explicitLockKey || prefabLockKey;
                                if (lockKey && this.saver.isLockUsed(lockKey)) continue;
                            }
                        } catch (e) { /* ignore lock-skip errors */ }

                        // Optional chance gate (used in chunks.json)
                        try {
                            const ch = entity.data && typeof entity.data.chance === 'number' ? entity.data.chance : null;
                            if (ch !== null && Number.isFinite(ch) && ch >= 0 && ch < 1) {
                                if (Math.random() > ch) continue;
                            }
                        } catch (e) {}

                        let wx, wy;
                        if (entity.pos === 'random'){
                            wx = (cx * this.chunkSize + 5) * this.noiseTileSize;
                            wy = (cy * this.chunkSize + 5) * this.noiseTileSize;
                        } else {
                            wx = (cx * this.chunkSize + Number(entity.pos[0] || 0)) * this.noiseTileSize;
                            wy = (cy * this.chunkSize + Number(entity.pos[1] || 0)) * this.noiseTileSize;
                        }
                        const sz = (entity.data && Array.isArray(entity.data.size)) ? new Vector(entity.data.size[0], entity.data.size[1]) : new Vector(this.noiseTileSize, this.noiseTileSize);
                        if (this.entityManager && typeof this.entityManager.addEntity === 'function') {
                            const meta = (entity && entity.data && typeof entity.data === 'object') ? entity.data : {};
                            this.entityManager.addEntity(entity.type, new Vector(wx, wy), sz, meta);
                        }
                    } catch(e) { /* ignore per-entity spawn errors */ }
                }
            }
        } catch(e) { /* ignore entity spawn errors */ }
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
                        if (Number.isFinite(nopts.split) && nopts.split >= 0) {
                            if (v === 1) carve = true;
                        } else {
                            let val = v;
                            if (!nopts.normalize) val = (v + 1) / 2;
                            if (val > threshold) carve = true;
                        }

                        if (carve) {
                            // carve only in the chunk's main layer
                            const tgt = layers[layerForChunk] || layers.base;
                            tgt[idx] = 'air';
                        }
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
                        // attempt to place ores in the region's effective layer
                        const effLayer = reg.layer || layerForChunk || 'base';
                        const cur = layers[effLayer][idx];
                        if (typeof cur === 'string' && cur !== 'air') {
                            for (let i = 0; i < spread.length; i++) {
                                const sopt = spread[i];
                                const chance = Number(sopt.chance || 0);
                                const pick = sopt.block_type;
                                // compute a per-ore random value so multiple ore types can be selected
                                const r = pseudo(seed + i * 2654435761, startX + x, startY + y);
                                if (r < chance) { layers[effLayer][idx] = pick; break; }
                            }
                        }
                    }
                }
            }
        }

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
                                    const idx = y * chunkSize + x;
                                    const v = caveMap.data[idx];
                                    if (typeof v === 'number' && v < threshold) {
                                        const tgt = layers[layerForChunk] || layers.base;
                                        tgt[idx] = 'air';
                                    }
                                }
                        }
                    } else if (s.type === 'ores') {
                        const spread = (s.data && s.data.spread) ? s.data.spread : [];
                        const seed = (this.noiseOptions && this.noiseOptions.seed) ? this.noiseOptions.seed : 1337;
                        const pseudo = (a, x, y) => { const n = x * 374761393 + y * 668265263 + (a|0) * 1274126177; const v = Math.sin(n) * 43758.5453123; return v - Math.floor(v); };
                        for (let y = 0; y < chunkSize; y++) {
                            for (let x = 0; x < chunkSize; x++) {
                                const idx = y * chunkSize + x;
                                const cur = layers[layerForChunk][idx];
                                if (typeof cur === 'string' && cur !== 'air') {
                                    for (const sopt of spread) {
                                        const chance = Number(sopt.chance || 0);
                                        const pick = sopt.block_type;
                                        const r = pseudo(seed, startX + x, startY + y);
                                        if (r < chance) { layers[layerForChunk][idx] = pick; break; }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        } catch (e) { /* ignore */ }
        const outChunk = { x: cx, y: cy, width: chunkSize, height: chunkSize, data: layers };
        outChunk.layer = layerForChunk;
        return outChunk;
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
        const tileSize = Number.isFinite(opts.tileSize) ? opts.tileSize : this.noiseTileSize;

        // Compute world-space rectangle for visible area
        let topLeft = camera.screenToWorld({ x: 0, y: 0 });
        let bottomRight = camera.screenToWorld({ x: 1920, y: 1080 });

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

        // Collect tiles into buckets by layer -> tilesheet to reduce context/texture switches.
        const layerBuckets = new Map(); // layerName -> Map(tilesheet|null -> [tileData])
        for (let sy = sy0; sy <= sy1; sy++) {
            for (let sx = sx0; sx <= sx1; sx++) {
                // Collect tiles from each layer so back/base/front can coexist
                const layerKeys = ['back','base'];
                for (const layerKey of layerKeys) {
                    const tile = this.getTileValue(sx, sy, layerKey);
                    if (!tile || !tile.id) continue;
                    const bid = tile.id;
                    const rot = tile.rot !== undefined ? tile.rot : 0;
                    const invert = tile.invert !== undefined ? tile.invert : false;
                    const ts = lookupTileSheet(bid);
                    const pos = new Vector(sx * tileSize, sy * tileSize);

                // Compute brightness now so it's available during render pass
                let brightness = 1;
                try {
                    if (sy < 0) brightness = 1.0;
                    else brightness = opts.lighting.getBrightness(sx, sy);
                } catch (e) { brightness = 1; }

                    // Store into buckets
                    const lk = tile.layer ? tile.layer : layerKey;
                    if (!layerBuckets.has(lk)) layerBuckets.set(lk, new Map());
                    const tsMap = layerBuckets.get(lk);
                    const tsKey = ts || null; // use null for missing tilesheet
                    if (!tsMap.has(tsKey)) tsMap.set(tsKey, []);
                    tsMap.get(tsKey).push({ pos, bid, rot, invert, rotSteps: Math.floor((rot % 360) / 90) % 4, invertVec: invert ? new Vector(-1,1) : null, brightness });
                }
                // end per-layer collection
            }
        }

        // Define rendering order and ensure base is drawn between bg and front
        const preferredOrder = ['back','base'];
        const presentLayers = Array.from(layerBuckets.keys());
        const orderedLayers = [];
        for (const p of preferredOrder) if (presentLayers.includes(p)) orderedLayers.push(p);
        for (const p of presentLayers) if (!orderedLayers.includes(p)) orderedLayers.push(p);

        // Render each layer in order, grouping by tilesheet to reduce state changes
        for (const layerName of orderedLayers) {
            const tsMap = layerBuckets.get(layerName);
            if (!tsMap) continue;
            // switch context once per layer
            // Note: the Draw instance registers the front canvas under the
            // name 'front' (singular). Map our layer key 'front' -> 'front'.
            const ctxName = (layerName === 'front') ? 'front' : layerName;
            try { draw.useCtx(ctxName); } catch (e) {}

            for (const [tsKey, items] of tsMap.entries()) {
                if (tsKey) {
                    // tilesheet present — draw tiles using draw.tile
                    for (const it of items) {
                        try {
                            draw.setBrightness(it.brightness);
                            draw.tile(tsKey, it.pos, tileSize, it.bid, it.rotSteps, it.invertVec, 1, false);
                            if(layerName === "back") draw.rect(it.pos,new Vector(tileSize,tileSize),"#00000088")
                        } catch (e) {
                            draw.rect(it.pos, new Vector(tileSize, tileSize), '#ff00ff88', false);
                        }
                    }
                } else {
                    // No tilesheet: draw placeholders
                    for (const it of items) {
                        let fillCol = '#ff00e1ff';
                        fillCol = opts.lighting.constructor.modulateColor('#f700ffff', it.brightness);
                        draw.setBrightness(it.brightness);
                        draw.rect(it.pos, new Vector(tileSize, tileSize), fillCol, true);
                    }
                }
                // reset brightness after group
                draw.setBrightness(1);
            }
        }
        // Restore drawing context to base for callers
        try { draw.useCtx('base'); } catch (e) {}
    }


    // Code related to saving a chunk to JSON goes beneath this line.
    /**
     * Merge a set of tile coordinates into an efficient list of rectangles.
     * Input: array of positions as `[x,y]` or `{x,y}`. Returns array of
     * rectangles where each item is either a single position `[x,y]` for a
     * 1x1 rect or `[[x0,y0],[x1,y1]]` for larger rects (inclusive bounds).
     *
     * This uses a greedy maximal-rectangle packing: iterate unassigned cells,
     * expand width then height while all cells exist, mark assigned, repeat.
     *
     * @param {Array} vectorArray
     * @returns {Array}
     */
    mergeMatrix(vectorArray){
        if(!Array.isArray(vectorArray) || vectorArray.length===0) return [];
        // Normalize positions to integer x,y and build a set
        const posSet = new Set();
        const toKey = (x,y)=>`${x},${y}`;
        const norm = [];
        for(const v of vectorArray){
            if(!v) continue;
            let x,y;
            if(Array.isArray(v)){ x = Number(v[0]); y = Number(v[1]); }
            else if(typeof v.x !== 'undefined' && typeof v.y !== 'undefined'){ x = Number(v.x); y = Number(v.y); }
            else continue;
            if(!Number.isFinite(x) || !Number.isFinite(y)) continue;
            x = Math.floor(x); y = Math.floor(y);
            const k = toKey(x,y);
            if(!posSet.has(k)){ posSet.add(k); norm.push([x,y]); }
        }
        if(norm.length===0) return [];

        // Build map for quick lookup
        const has = (x,y)=>posSet.has(toKey(x,y));
        const assigned = new Set();
        const out = [];

        // Sort positions to have deterministic processing (by y then x)
        norm.sort((a,b)=> (a[1]-b[1]) || (a[0]-b[0]));

        for(const p of norm){
            const sx = p[0], sy = p[1];
            const pk = toKey(sx,sy);
            if(assigned.has(pk)) continue;

            // determine maximal width from this start cell
            let width = 0;
            while(has(sx+width, sy) && !assigned.has(toKey(sx+width, sy))){ width++; }
            // expand downward while all cells for current width exist
            let height = 1;
            let keep = true;
            while(keep){
                const ny = sy + height;
                let rowWidth = 0;
                while(rowWidth < width && has(sx+rowWidth, ny) && !assigned.has(toKey(sx+rowWidth, ny))){ rowWidth++; }
                if(rowWidth === 0) break;
                // shrink width to rowWidth if needed
                if(rowWidth < width) width = rowWidth;
                height++;
            }

            // mark assigned cells
            for(let yy = sy; yy < sy+height; yy++){
                for(let xx = sx; xx < sx+width; xx++){
                    assigned.add(toKey(xx,yy));
                }
            }

            if(width === 1 && height === 1){
                out.push([sx,sy]);
            } else {
                out.push([[sx,sy],[sx+width-1, sy+height-1]]);
            }
        }

        return out;
    }
    /**
     * Convert a chunk into grouped coordinate arrays keyed by tile properties.
     * Priority: layer -> block_type -> special data. Returns an array of
     * [props, positions] where `props` is an object describing the shared
     * properties (e.g. { layer:'back', block_type:'red_sand', special:{...} })
     * and `positions` is an array of [x,y] vectors.
     *
     * @param {Object} chunk Chunk object as returned by `getChunk`/_ensureChunk
     * @returns {Array}
     */
    sortChunk(chunk){
        if(!chunk || !chunk.data) return [];
        const layersOrder = ['back','base','front'];
        const out = [];
        const map = new Map(); // key -> index in out

        const width = chunk.width || (chunk.data && chunk.data.base && Math.sqrt(chunk.data.base.length)) || this.chunkSize;
        const height = chunk.height || width;

        const getRaw = (x,y,layer)=>{
            if(!chunk.data) return null;
            // chunk.data may be per-layer object or a single array
            if(Array.isArray(chunk.data)){
                // chunk.data is a single-layer array. Only return values
                // when querying the chunk's actual layer to avoid emitting
                // the same tiles for every layer in the layersOrder loop.
                const chunkLayer = chunk.layer || 'base';
                if(layer !== chunkLayer) return null;
                const idx = y * width + x;
                return (idx>=0 && idx < chunk.data.length) ? chunk.data[idx] : null;
            }
            const arr = chunk.data[layer];
            if(!arr) return null;
            const idx = y * width + x;
            return (idx>=0 && idx < arr.length) ? arr[idx] : null;
        };

        const propsKey = (p)=>{
            // stable stringify with sorted keys for predictability
            const kobj = {};
            if(p.layer !== undefined) kobj.layer = p.layer;
            if(p.block_type !== undefined) kobj.block_type = p.block_type;
            if(p.special !== undefined) kobj.special = p.special;
            return JSON.stringify(kobj);
        };

        for(const layer of layersOrder){
            for(let y=0;y<height;y++){
                for(let x=0;x<width;x++){
                    const raw = getRaw(x,y,layer);
                    if(raw === null || raw === 'air' || raw === '') continue;
                    // build properties object
                    const p = {};
                    p.layer = layer;
                    if(typeof raw === 'string'){
                        p.block_type = raw;
                    } else if(typeof raw === 'object' && raw !== null){
                        if(raw.id) p.block_type = raw.id;
                        // include special subset if present
                        if(raw.rot !== undefined || raw.invert !== undefined){
                            p.special = {};
                            if(raw.rot !== undefined) p.special.rot = raw.rot;
                            if(raw.invert !== undefined) p.special.invert = raw.invert;
                        }
                        // copy other explicit properties if present (e.g., layer)
                        if(raw.layer) p.layer = raw.layer;
                    }

                    const key = propsKey(p);
                    if(map.has(key)){
                        out[map.get(key)][1].push([x,y]);
                    } else {
                        const idx = out.length;
                        map.set(key, idx);
                        out.push([p, [[x,y]]]);
                    }
                }
            }
        }

        return out;
    }
    /**
     * Save a single chunk. By default this will prompt/download the JSON file.
     * If `opts.download` is false, the JSON object will be returned instead.
     */
    saveChunk(x,y, opts = { download: true }){
        const chunk = this.getChunk(x,y);
        if(!chunk) return false;

        // Group tiles by properties
        const groups = this.sortChunk(chunk);
        // Start with a full-chunk 'air' region so mined/cleared tiles
        // (which are stored as empty/air and therefore omitted by
        // `sortChunk`) are preserved when saving. Subsequent regions
        // will override this baseline.
        const regions = [];
        try{
            const w = (chunk.width && Number.isFinite(chunk.width)) ? chunk.width : this.chunkSize;
            const h = (chunk.height && Number.isFinite(chunk.height)) ? chunk.height : this.chunkSize;
            regions.push({ region: [[0,0],[Math.max(0,w-1), Math.max(0,h-1)]], block_type: 'air' });
            // reflect that we've emitted 'air' so compacting logic knows the
            // previous block_type (we'll set prevBlockType below after vars)
        }catch(e){}

        // Emit regions but compress repeated fields to mimic the compact
        // inheritance used by `_generateChunkJSON`. We track previous
        // emitted values and only include `block_type`, `layer`, or
        // `special` when they change.
        let prevBlockType = 'air';
        let prevLayer = undefined;
        let prevRot = 0;
        let prevInvert = false;

        for(const entry of groups){
            const props = entry[0] || {};
            const positions = entry[1] || [];
            if(!positions || positions.length===0) continue;
            const rects = this.mergeMatrix(positions);
            for(const r of rects){
                const regionFull = {};
                if(Array.isArray(r) && r.length===2 && typeof r[0] === 'number'){
                    // single tile
                    regionFull.region = [[r[0], r[1]]];
                } else if(Array.isArray(r) && Array.isArray(r[0])){
                    regionFull.region = [r[0], r[1]];
                } else {
                    continue;
                }

                // Determine full values for this region
                const fullBlockType = (props.block_type !== undefined) ? props.block_type : null;
                const fullLayer = (props.layer !== undefined) ? props.layer : (chunk.layer !== undefined ? chunk.layer : 'base');
                const fullSpecial = (props.special !== undefined) ? { rot: (props.special.rot !== undefined ? props.special.rot : 0), invert: (props.special.invert !== undefined ? props.special.invert : false) } : { rot: 0, invert: false };

                // Build compact region object using inheritance from previous emitted region
                const compact = { region: regionFull.region };

                // block_type: include when it changes (or when first defined)
                if(fullBlockType !== null && fullBlockType !== prevBlockType){ compact.block_type = fullBlockType; prevBlockType = fullBlockType; }

                // layer: include when it differs from previous. If previous undefined
                // and layer equals chunk.layer, omit to allow generator to inherit chunk default.
                if(prevLayer === undefined){
                    if(fullLayer !== (chunk.layer !== undefined ? chunk.layer : 'base')){ compact.layer = fullLayer; prevLayer = fullLayer; }
                    else { prevLayer = fullLayer; }
                } else {
                    if(fullLayer !== prevLayer){ compact.layer = fullLayer; prevLayer = fullLayer; }
                }

                // special: include only when it differs from previous (rot/invert)
                if(fullSpecial.rot !== prevRot || fullSpecial.invert !== prevInvert){ compact.special = { rot: fullSpecial.rot, invert: fullSpecial.invert }; prevRot = fullSpecial.rot; prevInvert = fullSpecial.invert; }

                regions.push(compact);
            }
        }

        // Internal representation used for saver/local overrides. This is what
        // `this.saver` stores under `chunks/<x>,<y>` and is consumed by
        // `_generateChunkJSON` as a saved override.
        const out = { x: chunk.x, y: chunk.y, width: chunk.width, height: chunk.height, regions: regions };
        // Include placed entities (e.g., torches) that fall inside this chunk
        try {
            const ents = [];
            const baseSx = x * this.chunkSize;
            const baseSy = y * this.chunkSize;
            if (this.entityManager && Array.isArray(this.entityManager.entities)) {
                for (const ent of this.entityManager.entities) {
                    try {
                        if (!ent || !ent.pos) continue;
                        // Identify torches by presence of a LightComponent (prefab torch uses LightComponent)
                        const lightComp = typeof ent.getComponent === 'function' ? ent.getComponent('light') : null;
                        if (!lightComp) continue;
                        // convert world pixel pos to sample coords
                        const px = ent.pos.x + (ent.size && ent.size.x ? ent.size.x * 0.5 : 0);
                        const py = ent.pos.y + (ent.size && ent.size.y ? ent.size.y * 0.5 : 0);
                        const ts = this.noiseTileSize || 16;
                        const tsx = Math.floor(px / ts);
                        const tsy = Math.floor(py / ts);
                        const lx = tsx - baseSx;
                        const ly = tsy - baseSy;
                        if (lx >= 0 && lx < this.chunkSize && ly >= 0 && ly < this.chunkSize) {
                            ents.push({ type: 'torch', pos: [lx, ly], data: { size: [ts, ts], level: (lightComp && lightComp.level) ? lightComp.level : (this.lightingSystem ? this.lightingSystem.maxLight : 15) } });
                        }
                    } catch(e) { /* ignore per-entity errors */ }
                }
            }
            if (ents.length > 0) out.entities = ents;
            console.log('saved')
        } catch (e) { /* ignore torch serialization errors */ }
        if (opts && opts.download === false) {
            return out;
        }
        // Default behaviour: prompt/save to file using Saver.saveJSON.
        // For downloads, emit a JSON shape that matches a single chunk
        // definition from data/chunks.json:
        //   {
        //     "dependencies": [...],
        //     "data": { bg, regions, entities }
        //   }
        // This makes the exported file directly usable as a chunk spec
        // when referenced from generation.json or merged into chunks.json.
        try {
            const exported = {
                dependencies: [],
                data: {
                    bg: 'air',
                    regions: out.regions
                }
            };
            if (Array.isArray(out.entities) && out.entities.length > 0) {
                exported.data.entities = out.entities;
            }

            Saver.saveJSON(exported, `chunk_${x}_${y}.json`, {});
            return true;
        } catch (e) {
            console.error('saveChunk: Saver.saveJSON failed', e);
            return false;
        }
    }

    /**
     * Save all modified chunks. Returns an array of { x, y, regions } for
     * each modified chunk. If a `Saver` instance was provided to the
     * constructor, saved chunk objects will be stored under
     * `chunks/<x>,<y>` in the saver and persisted once at the end.
     */
    save(){
        const results = [];
        const layers = Object.keys(this.chunks || {});
        for (const ln of layers) {
            const bucket = this.chunks[ln] || {};
            for (const key of Object.keys(bucket)) {
                const entry = bucket[key];
                if (!entry || !entry.data) continue;
                if (entry.data.modified) {
                    const parts = key.split(',').map(Number);
                    const cx = parts[0];
                    const cy = parts[1];
                    try {
                        const out = this.saveChunk(cx, cy, { download: false });
                        if (out && out.regions) {
                            results.push({ x: out.x, y: out.y, regions: out.regions });
                            if (this.saver && typeof this.saver.set === 'function') {
                                // store without auto-saving each time, we'll save once below
                                this.saver.set(`chunks/${out.x},${out.y}`, out, false);
                            }
                            // mark chunk as not modified after saving
                            entry.data.modified = false;
                        }
                    } catch (e) {
                        console.warn('ChunkManager.save: failed saving chunk', key, e);
                    }
                }
            }
        }
        if (this.saver && typeof this.saver.save === 'function') {
            try { this.saver.save(); } catch(e) { console.warn('ChunkManager.save: saver.save failed', e); }
        }
        return results;
    }
}