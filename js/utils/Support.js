import Vector from '../modules/Vector.js';

export const getID = document.getElementById.bind(document);

export function addEvent(target, item, event, func) {
    if (target === "item" && item instanceof HTMLElement) {
        item.addEventListener(event, func);
    } else if (target === "window") {
        window.addEventListener(event, func);
    } else if (typeof item === "string") {
        const el = document.getElementById(item);
        if (el) el.addEventListener(event, func);
        else console.warn(`Element with id "${item}" not found.`);
    } else {
        console.warn("Invalid target/item provided to addEvent.");
    }
}
/**
 * @function
 * @description Deep clone a class instance.
 * @param {object} instance The class instance you want to clone.
 * @returns {object} A new cloned instance.
 */
export function clone(instance) {
  return Object.assign(
    Object.create(
      // Set the prototype of the new object to the prototype of the instance.
      // Used to allow new object behave like class instance.
      Object.getPrototypeOf(instance),
    ),
    // Prevent shallow copies of nested structures like arrays, etc
    JSON.parse(JSON.stringify(instance)),
  );
}
/*Tetration*/
export function TET(a, n) {
  if (n === 0) return 1; // by convention
  if (n === 1) return a;

  // If n is an integer >= 1, do the normal tower
  if (Number.isInteger(n) && n > 1) {
    let result = a;
    for (let i = 1; i < n; i++) {
      result = Math.pow(a, result); // right-assoc
      if (!Number.isFinite(result)) return result; // Infinity or NaN
    }
    return result;
  }

  // If n is fractional/negative: approximate using continuous iteration
  // Simple method: interpolate between heights using fixed-point iteration
  const k = Math.floor(n);              // integer part
  const frac = n - k;                   // fractional part
  let tower = TET(a, k);          // build integer tower
  if (frac === 0) return tower;

  // crude fractional step: weighted geometric mean between
  // tower at height k and k+1
  const nextTower = TET(a, k + 1);
  return Math.pow(tower, 1 - frac) * Math.pow(nextTower, frac);
}
export function copyToClipboard(text) {
    navigator.clipboard.writeText(text)
    .then(() => {
        console.log('Copied to clipboard:', text);
    })
    .catch(err => {
        console.error('Failed to copy: ', err);
    });
}

/**
 * Merge missing defaults into `obj` in-place and return `obj`.
 * If a default value exposes a `.clone()` method it will be cloned when
 * assigned to avoid sharing mutable instances across callers.
 * @param {object} obj - target object to receive defaults (may be mutated)
 * @param {object} defaults - defaults to apply when keys are missing
 * @returns {object}
 */
export function mergeObjects(obj, defaults) {
    if (!obj || typeof obj !== 'object') obj = {};
    if (!defaults || typeof defaults !== 'object') return obj;
    for (const k of Object.keys(defaults)) {
        if (obj[k] === undefined) {
            const v = defaults[k];
            // If the default is a Vector, clone it using Vector.clone()
            if (v instanceof Vector) {
                obj[k] = v.clone();
            } else if (v && typeof v === 'object' && typeof v.clone === 'function') {
                obj[k] = v.clone();
            } else if (v && typeof v === 'object') {
                // Preserve class instances (like SpriteSheet) by assigning the
                // original object reference. For plain objects, make a shallow
                // copy so callers don't accidentally mutate the defaults.
                if (Array.isArray(v)) {
                    obj[k] = v.slice();
                } else {
                    const proto = Object.getPrototypeOf(v);
                    if (proto && proto !== Object.prototype) {
                        // likely a class instance — keep reference
                        obj[k] = v;
                    } else {
                        // plain object — shallow copy
                        obj[k] = Object.assign({}, v);
                    }
                }
            } else {
                obj[k] = v;
            }
        }
    }
    return obj;
}

/**
 * Create a new plain object containing properties taken from `instance`
 * but limited to the keys present in `defaults`.
 * - Vector values are cloned using `Vector.clone()`.
 * - If a property exposes `.clone()` it will be used.
 * - Plain objects/arrays are shallow-copied.
 *
 * @param {object} defaults - template object whose keys determine which properties to pick
 * @param {object} instance - class instance to read values from
 * @returns {object} new object with picked (and cloned when appropriate) properties
 */
export function pickDefaults(defaults, instance) {
    const out = {};
    if (!defaults || typeof defaults !== 'object') return out;
    if (!instance || typeof instance !== 'object') return out;

    for (const k of Object.keys(defaults)) {
        if (instance[k] === undefined) continue;
        const v = instance[k];
        if (v instanceof Vector) {
            out[k] = v.clone();
        } else if (v && typeof v === 'object' && typeof v.clone === 'function') {
            out[k] = v.clone();
        } else if (v && typeof v === 'object') {
            // For class instances (non-plain objects) preserve the original
            // reference so methods like `connect()` remain available. For
            // plain objects/arrays, perform a shallow copy.
            if (Array.isArray(v)) {
                out[k] = v.slice();
            } else {
                const proto = Object.getPrototypeOf(v);
                if (proto && proto !== Object.prototype) {
                    out[k] = v;
                } else {
                    out[k] = Object.assign({}, v);
                }
            }
        } else {
            out[k] = v;
        }
    }

    return out;
}
