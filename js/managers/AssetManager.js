import TileSheet from "../modules/Tilesheet.js";
import SpriteSheet from "../modules/Spritesheet.js";


async function _loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error('Failed to load image: ' + src));
        img.src = src;
    });
}

/**
 * Result returned by `loadTexturesJSON`.
 * @typedef {Object} TexturesLoadResult
 * @property {Map<string, Object>} tilemaps - Map of tilemap name -> TileSheet instance
 * @property {Map<string, Object>} sprites - Map of spritesheet name -> SpriteSheet instance
 * @property {Map<string, Object>} [blocks] - Optional map of block id -> metadata
 * @property {Object|null} raw - Raw parsed JSON from the textures file
 */

/**
 * Load textures JSON and create TileSheet / SpriteSheet instances.
 * Returns a Promise resolving to a `TexturesLoadResult`.
 *
 * @param {string} [jsonPath='./data/textures.json'] - Path to textures JSON file
 * @returns {Promise<TexturesLoadResult>} Loaded assets and metadata
 */
export async function loadTexturesJSON(jsonPath = './data/textures.json') {
    const res = { tilemaps: new Map(), sprites: new Map(), raw: null };
    try {
        const resp = await fetch(jsonPath, { cache: 'no-cache' });
        if (!resp.ok) throw new Error('Failed to fetch ' + jsonPath + ' (' + resp.status + ')');
        const j = await resp.json();
        res.raw = j;

        // Tilemaps
        if (j.tilemaps && typeof j.tilemaps === 'object') {
            for (const key of Object.keys(j.tilemaps)) {
                try {
                    const info = j.tilemaps[key];
                    const path = info.path;
                    const slicePx = info.slicePx || (info.slice || 16);
                    const img = await _loadImage(path);
                    // Create TileSheet but do NOT auto-generate tile names. Block and
                    // usage JSON will register concrete tile keys (use block ids).
                    const ts = new TileSheet(img, slicePx);
                    res.tilemaps.set(key, ts);
                } catch (e) {
                    console.warn('AssetManager: failed to load tilemap', key, e);
                }
            }
        }

        // SpriteSheets
        if (j.spriteSheets && typeof j.spriteSheets === 'object') {
            for (const key of Object.keys(j.spriteSheets)) {
                try {
                    const info = j.spriteSheets[key];
                    const path = info.path;
                    const slicePx = info.slicePx || 16;
                    const img = await _loadImage(path);
                    const ss = new SpriteSheet(img, slicePx);
                    // add animations if provided
                    if (info.animations && typeof info.animations === 'object') {
                        for (const aname of Object.keys(info.animations)) {
                            const a = info.animations[aname];
                            try {
                                const row = Number(a.row || 0);
                                const frameCount = Number(a.frameCount || 1);
                                const fps = Number(a.fps || 8);
                                const buffer = Number(a.buffer || 0);
                                const onStop = a.onStop || 'loop';
                                const swapName = a.swapName || 'idle';
                                ss.addAnimation(aname, row, frameCount, fps, buffer, onStop, swapName);
                                // materialize first frame lazily when requested by Sprite
                                // create lazy descriptors in _frames so _rebuildSheetCanvas can pack
                                const arr = [];
                                for (let i = 0; i < frameCount; i++) {
                                    arr.push({ __lazy: true, src: img, sx: i * slicePx, sy: row * slicePx, w: slicePx, h: slicePx });
                                }
                                ss._frames.set(aname, arr);
                                ss._rebuildSheetCanvas();
                            } catch (e) { /* ignore animation err */ }
                        }
                    }
                    res.sprites.set(key, ss);
                } catch (e) {
                    console.warn('AssetManager: failed to load spritesheet', key, e);
                }
            }
        }

        // Attempt to load blocks.json so block IDs can register tile keys
        try {
            const bresp = await fetch('./data/blocks.json', { cache: 'no-cache' });
            if (bresp.ok) {
                const bj = await bresp.json();
                res.blocks = new Map();
                if (bj.blocks && typeof bj.blocks === 'object') {
                    for (const bid of Object.keys(bj.blocks)) {
                        try {
                            const entry = bj.blocks[bid];
                            const tex = entry.texture || null;
                            // If texture references a tilemap and pos, register a tile in that TileSheet
                            if (tex && typeof tex === 'object' && typeof tex.tilemap === 'string' && Array.isArray(tex.pos)) {
                                const tm = res.tilemaps.get(tex.tilemap);
                                if (tm) {
                                    const col = Math.floor(tex.pos[0] || 0);
                                    const row = Math.floor(tex.pos[1] || 0);
                                    try { tm.addTile(bid, row, col); } catch (e) { /* ignore */ }
                                }
                            }
                            const meta = { id: bid, texture: tex, data: entry.data || {} };
                            res.blocks.set(bid, meta);
                        } catch (e) { /* ignore block parse errors */ }
                    }
                }
            }
        } catch (e) {
            // non-fatal
        }

        return res;
    } catch (err) {
        console.error('AssetManager.loadTexturesJSON failed:', err);
        return res;
    }
}

export default { loadTexturesJSON };
