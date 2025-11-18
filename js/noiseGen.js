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
 * @param {number} [options.scale=50] - feature scale (larger -> larger features)
 * @param {number} [options.octaves=1] - number of fractal octaves
 * @param {number} [options.persistence=0.5] - amplitude multiplier per octave
 * @param {number} [options.lacunarity=2.0] - frequency multiplier per octave
 * @param {number} [options.seed] - integer seed (default random)
 * @param {boolean} [options.normalize=true] - normalize output to [0,1]
 * @returns {{width:number,height:number,data:Float32Array}}
 */
export function perlinNoise(width, height, options = {}){
    const opts = Object.assign({
        scale: 50,
        octaves: 1,
        persistence: 0.5,
        lacunarity: 2.0,
        seed: Math.floor(Math.random() * 65536),
        normalize: true
    }, options || {});

    const scale = (opts.scale <= 0) ? 1 : opts.scale;
    const perm = buildPerm(opts.seed >>> 0);
    const data = new Float32Array(width * height);

    let min = Infinity, max = -Infinity;

    for(let j=0;j<height;j++){
        for(let i=0;i<width;i++){
            let amplitude = 1.0;
            let frequency = 1.0;
            let noiseValue = 0.0;
            for(let o=0;o<opts.octaves;o++){
                const sampleX = (i / scale) * frequency;
                const sampleY = (j / scale) * frequency;
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

    return { width, height, data };
}

// small usage example (comment):
// import { perlinNoise } from './js/noiseGen.js';
// const map = perlinNoise(256,256,{scale:80,octaves:4,seed:12345});
// use map.data[y*map.width + x] (0..1) for tile decisions
