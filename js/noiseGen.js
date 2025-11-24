/**
 * Perlin noise generator module.
 *
 * Exported function: `perlinNoise(width, height, options)`
 * Returns an object `{ width, height, data }` where `data` is a
 * `Float32Array` of length `width * height` containing noise values
 * (normalized to 0..1 by default).
 *
 * Options:
 *  - `scale` (number): feature size; larger = bigger blobs (default 50)
 *  - `octaves` (int): number of fractal octaves (default 1)
 *  - `persistence` (number): amplitude multiplier per octave (default 0.5)
 *  - `lacunarity` (number): frequency multiplier per octave (default 2.0)
 *  - `seed` (int): integer seed for deterministic output (default random)
 *  - `normalize` (bool): if true, map results to [0,1] (default true)
 *
 * Example:
 * ```js
 * import { perlinNoise } from './js/noiseGen.js';
 * const map = perlinNoise(256, 256, { scale: 80, octaves: 4, seed: 12345 });
 * const v = map.data[y * map.width + x]; // 0..1
 * ```
 */

/**
 * Smoothstep / easing function used by Perlin interpolation.
 * @param {number} t - input in range [0,1]
 * @returns {number} eased value
 */
function fade(t){ return t * t * t * (t * (t * 6 - 15) + 10); }

/**
 * Linear interpolation.
 * @param {number} a - start
 * @param {number} b - end
 * @param {number} t - interpolation factor [0,1]
 * @returns {number}
 */
function lerp(a,b,t){ return a + t * (b - a); }

/**
 * Dot product helper for gradient and offset vectors.
 * @param {number} gx - gradient x
 * @param {number} gy - gradient y
 * @param {number} x - offset x
 * @param {number} y - offset y
 * @returns {number}
 */
function dot(gx,gy, x, y){ return gx * x + gy * y; }

// Seeded RNG (Mulberry32)
/**
 * Create a seeded RNG using Mulberry32-ish mixing. Returns a function
 * that yields pseudo-random numbers in [0,1).
 * @param {number} seed - integer seed
 * @returns {function():number}
 */
function makeRNG(seed){
    let t = seed >>> 0;
    return function(){
        t += 0x6D2B79F5;
        let r = Math.imul(t ^ (t >>> 15), 1 | t);
        r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
        return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    };
}

/**
 * Build a 512-entry permutation table (concatenated 0..255 twice)
 * shuffled by the provided seed. Used to produce deterministic
 * gradient selection for lattice points.
 * @param {number} seed - integer seed
 * @returns {Uint8Array} perm - length 512
 */
function buildPerm(seed){
    const rng = makeRNG(seed >>> 0);
    const p = new Uint8Array(256);
    for(let i=0;i<256;i++) p[i] = i;
    // Fisher-Yates shuffle
    for(let i=255;i>0;i--){
        const j = Math.floor(rng() * (i + 1));
        const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    const perm = new Uint8Array(512);
    for(let i=0;i<512;i++) perm[i] = p[i & 255];
    return perm;
}

// 8 directional gradients (unit / normalized)
const GRADS = [
    [1,0],[-1,0],[0,1],[0,-1],
    [Math.SQRT1_2,Math.SQRT1_2],[-Math.SQRT1_2,Math.SQRT1_2],
    [Math.SQRT1_2,-Math.SQRT1_2],[-Math.SQRT1_2,-Math.SQRT1_2]
];

/**
 * Select a gradient vector from the permutation table at lattice
 * coordinates (ix, iy).
 * @param {Uint8Array} perm - permutation table (512 entries)
 * @param {number} ix - integer x index
 * @param {number} iy - integer y index
 * @returns {[number,number]} gradient vector [gx,gy]
 */
function gradFromHash(perm, ix, iy){
    const h = perm[(perm[(ix & 255)] + (iy & 255)) & 255] & 7;
    return GRADS[h];
}

/**
 * Compute 2D Perlin noise at (x,y) using the provided permutation table.
 * Coordinates may be fractional; lattice corners are determined by floor().
 * Returns roughly in the range [-1,1].
 *
 * @param {Uint8Array} perm - permutation table
 * @param {number} x - sample x (float)
 * @param {number} y - sample y (float)
 * @returns {number} noise value approx in [-1,1]
 */
function perlin2(perm, x, y){
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const xf = x - x0, yf = y - y0;
    const u = fade(xf), v = fade(yf);

    const g00 = gradFromHash(perm, x0, y0);
    const g10 = gradFromHash(perm, x0 + 1, y0);
    const g01 = gradFromHash(perm, x0, y0 + 1);
    const g11 = gradFromHash(perm, x0 + 1, y0 + 1);

    const n00 = dot(g00[0], g00[1], xf,     yf);
    const n10 = dot(g10[0], g10[1], xf - 1, yf);
    const n01 = dot(g01[0], g01[1], xf,     yf - 1);
    const n11 = dot(g11[0], g11[1], xf - 1, yf - 1);

    const ix0 = lerp(n00, n10, u);
    const ix1 = lerp(n01, n11, u);
    const value = lerp(ix0, ix1, v);
    return value; // typically in approx [-1,1]
}

/**
 * Generate a 2D Perlin noise field.
 *
 * @param {number} width - width of the generated field (samples)
 * @param {number} height - height of the generated field (samples)
 * @param {object} [options]
 * @param {number} [options.scale=5] - feature scale (larger -> larger features)
 * @param {number} [options.octaves=1] - number of fractal octaves
 * @param {number} [options.persistence=0.5] - amplitude multiplier per octave
 * @param {number} [options.lacunarity=2.0] - frequency multiplier per octave
 * @param {number} [options.seed] - integer seed (default random)
 * @param {boolean} [options.normalize=true] - normalize output to [0,1]
 * @param {number} [options.split=0.5] - optional threshold in [0,1]; set to a value >= 0 to
 *                                       produce a binary map (values >= split -> 1, else 0).
 * @param {boolean} [options.connect=true] - when `split >= 0` and `connect` is true,
 *                                            post-process the binary map to connect
 *                                            separated components by drawing straight
 *                                            bridges to the largest component.
 * @param {number} [options.bridgeWidth=3] - thickness (in pixels) of the connecting bridge.
 * @param {number} [options.offsetX=0] - horizontal sample offset (in sample units). Use
 *                                       this to shift the noise pattern horizontally.
 * @param {number} [options.offsetY=0] - vertical sample offset (in sample units). Use
 *                                       this to shift the noise pattern vertically.
 * @returns {{width:number,height:number,data:Float32Array}}
 */
export function perlinNoise(width=64, height=64, options = {}){
    const opts = Object.assign({
        scale: 50,
        octaves: 1,
        persistence: 0.5,
        lacunarity: 2.0,
        seed: Math.floor(Math.random() * 65536),
        normalize: true,
        split: -1
    }, options || {});

    const scale = (opts.scale <= 0) ? 1 : opts.scale;
    const perm = buildPerm(opts.seed >>> 0);
    const data = new Float32Array(width * height);

    let min = Infinity, max = -Infinity;

    const ox = parseFloat(opts.offsetX || 0) || 0;
    const oy = parseFloat(opts.offsetY || 0) || 0;

    for(let j=0;j<height;j++){
        for(let i=0;i<width;i++){
            let amplitude = 1.0;
            let frequency = 1.0;
            let noiseValue = 0.0;
            for(let o=0;o<opts.octaves;o++){
                const sampleX = ((i + ox) / scale) * frequency;
                const sampleY = ((j + oy) / scale) * frequency;
                noiseValue += perlin2(perm, sampleX, sampleY) * amplitude;
                amplitude *= opts.persistence;
                frequency *= opts.lacunarity;
            }
            const idx = j * width + i;
            data[idx] = noiseValue;
            if (noiseValue < min) min = noiseValue;
            if (noiseValue > max) max = noiseValue;
        }
    }

    if (opts.normalize){
        // Normalize to 0..1
        const range = max - min || 1;
        for(let k=0;k<data.length;k++) data[k] = (data[k] - min) / range;
    }

    // Optional split threshold: convert to binary map where values >= split => 1, else 0
    if (opts.split >= 0) {
        const s = opts.split;
        for (let k = 0; k < data.length; k++) data[k] = (data[k] >= s) ? 1 : 0;
    }

    // Optional connectivity post-process for binary maps: connect islands to the
    // largest component by drawing straight-line bridges (Bresenham) between
    // nearest border cells. Useful to ensure continuous caves when `split` is used.
    if (opts.split >= 0 && opts.connect) {
        const w = width, h = height;
        // label components (4-neighbor)
        const labels = new Int32Array(w * h);
        let curLabel = 0;
        const stack = [];
        const comps = [];

        const idxAt = (x,y) => (y * w + x);

        for (let y = 0; y < h; y++){
            for (let x = 0; x < w; x++){
                const i = idxAt(x,y);
                if (data[i] !== 1 || labels[i] !== 0) continue;
                curLabel++;
                labels[i] = curLabel;
                stack.length = 0;
                stack.push(i);
                const comp = { id: curLabel, cells: [], border: [] };
                while (stack.length){
                    const ci = stack.pop();
                    comp.cells.push(ci);
                    const cx = ci % w, cy = Math.floor(ci / w);
                    // check 4 neighbors
                    const neigh = [ [cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1] ];
                    let isBorder = false;
                    for (let ni=0; ni<neigh.length; ni++){
                        const nx = neigh[ni][0], ny = neigh[ni][1];
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) { isBorder = true; continue; }
                        const niidx = idxAt(nx,ny);
                        if (data[niidx] !== 1) { isBorder = true; continue; }
                        if (labels[niidx] === 0){ labels[niidx] = curLabel; stack.push(niidx); }
                    }
                    if (isBorder) comp.border.push(ci);
                }
                comps.push(comp);
            }
        }

        if (comps.length > 1){
            // find largest component (by cells length)
            comps.sort((a,b) => b.cells.length - a.cells.length);
            const main = comps[0];
            const others = comps.slice(1);
            const bridgeW = Math.max(1, Math.floor(opts.bridgeWidth || 1));

            // helper to draw a pixel/filled square of size bridgeW
            const setPixel = (px, py) => {
                for (let yy = -Math.floor(bridgeW/2); yy <= Math.floor((bridgeW-1)/2); yy++){
                    for (let xx = -Math.floor(bridgeW/2); xx <= Math.floor((bridgeW-1)/2); xx++){
                        const nx = px + xx, ny = py + yy;
                        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
                        data[idxAt(nx,ny)] = 1;
                    }
                }
            };

            // Bresenham line drawing between two points
            const drawLine = (x0, y0, x1, y1) => {
                let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
                let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
                let err = dx + dy;
                let x = x0, y = y0;
                while (true){
                    setPixel(x,y);
                    if (x === x1 && y === y1) break;
                    const e2 = 2 * err;
                    if (e2 >= dy) { err += dy; x += sx; }
                    if (e2 <= dx) { err += dx; y += sy; }
                }
            };

            // For each other component, find the nearest border pixel to any main border pixel
            // and draw a bridge.
            // Build array of main border coords
            const mainBorders = main.border.map(ci => [ci % w, Math.floor(ci / w)]);

            for (const comp of others){
                let best = { d2: Infinity, a: null, b: null };
                for (const ci of comp.border){
                    const bx = ci % w, by = Math.floor(ci / w);
                    for (const mb of mainBorders){
                        const dx = bx - mb[0], dy = by - mb[1];
                        const d2 = dx*dx + dy*dy;
                        if (d2 < best.d2){ best = { d2, a: [bx,by], b: [mb[0],mb[1]] }; }
                    }
                }
                if (best.a && best.b){
                    drawLine(best.a[0], best.a[1], best.b[0], best.b[1]);
                }
            }
        }
    }

    return { width, height, data };
}

// small usage example (comment):
// import { perlinNoise } from './js/noiseGen.js';
// const map = perlinNoise(256,256,{scale:80,octaves:4,seed:12345});
// use map.data[y*map.width + x] (0..1) for tile decisions
