export default class Saver {
    constructor(storageKey = "gameData") {
        this.storageKey = storageKey;
        this.savedata = {};
        this._beforeSave = [];
        this.load();
    }

    // Load saved data from localStorage
    load() {
        const data = localStorage.getItem(this.storageKey);
        if (data) {
            try {
                this.savedata = JSON.parse(data);
            } catch (e) {
                console.error("Failed to parse saved data:", e);
                this.savedata = {};
            }
        } else {
        this.savedata = {};
        }
    }

    // Save current savedata to localStorage
    save() {
        try {
            // run before-save hooks
            try {
                if (Array.isArray(this._beforeSave)) {
                    for (const cb of this._beforeSave) {
                        try { cb(); } catch (e) { /* ignore hook errors */ }
                    }
                }
            } catch (e) { /* ignore */ }

            localStorage.setItem(this.storageKey, JSON.stringify(this.savedata));
        } catch (e) {
            console.error("Failed to save data:", e);
        }
    }

    /**
     * Register a callback to be invoked before save() writes to storage.
     * Callback should be synchronous; errors are swallowed.
     * @param {Function} cb
     */
    onBeforeSave(cb) {
        if (typeof cb !== 'function') return;
        if (!Array.isArray(this._beforeSave)) this._beforeSave = [];
        this._beforeSave.push(cb);
    }

    _getPathObj(path, createMissing = false) {
        const keys = path.split("/");
        let obj = this.savedata;
        for (let i = 0; i < keys.length - 1; i++) {
            if (!obj[keys[i]]) {
                if (createMissing) obj[keys[i]] = {};
                else return undefined;
            }
            obj = obj[keys[i]];
        }
        return { obj, lastKey: keys[keys.length - 1] };
    }

    // Set value using path
    set(path, value, autoSave = true) {
        const { obj, lastKey } = this._getPathObj(path, true);
        obj[lastKey] = value;
        if (autoSave) this.save();
    }

    // Get value using path
    get(path, defaultValue = null) {
        const res = this._getPathObj(path, false);
        if (!res) return defaultValue;
        const { obj, lastKey } = res;
        return obj.hasOwnProperty(lastKey) ? obj[lastKey] : defaultValue;
    }

    // Get value or add default if it doesn't exist
    getOrAdd(path, defaultValue) {
        const res = this._getPathObj(path, true);
        const { obj, lastKey } = res;
        if (!obj.hasOwnProperty(lastKey)) {
            obj[lastKey] = defaultValue;
            this.save();
        }
        return obj[lastKey];
    }

    // Remove value using path
    remove(path, autoSave = true) {
        const res = this._getPathObj(path, false);
        if (!res) return;
        const { obj, lastKey } = res;
        delete obj[lastKey];
        if (autoSave) this.save();
    }

    // Clear all data
    clear(autoSave = true) {
        this.savedata = {};
        if (autoSave) this.save();
    }

    // Load JSON from a URL or File object. Returns parsed object or null on failure.
    // Supports either: `Saver.loadJSON(path, onLoaded)` or `Saver.loadJSON(path, { onLoaded, cache })`.
    static loadJSON = async function(path, onLoaded = null, options = {}){
        try{
            let result = null;

            // If a string is provided, treat as URL and fetch it
            if(typeof path === 'string'){
                const resp = await fetch(path, { cache: options.cache || 'no-cache' });
                if(!resp.ok) throw new Error('Network response was not ok: ' + resp.status);
                result = await resp.json();
            }

            // If a File object is provided (e.g., from an <input type="file">), read it
            else if(typeof File !== 'undefined' && path instanceof File){
                result = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => {
                        try{
                            resolve(JSON.parse(reader.result));
                        }catch(e){
                            reject(e);
                        }
                    };
                    reader.onerror = () => reject(reader.error);
                    reader.readAsText(path);
                });
            }

            // If an object with a `url` property is provided, fetch that
            else if(path && typeof path === 'object' && typeof path.url === 'string'){
                const resp = await fetch(path.url, { cache: options.cache || 'no-cache' });
                if(!resp.ok) throw new Error('Network response was not ok: ' + resp.status);
                result = await resp.json();
            }

            else {
                throw new Error('Unsupported path type for Saver.loadJSON');
            }

            // If an onLoaded callback is provided, call it with the parsed object.
            if(typeof onLoaded === 'function'){
                try{
                    const maybePromise = onLoaded(result);
                    if(maybePromise instanceof Promise) await maybePromise;
                }catch(cbErr){
                    console.error('Saver.loadJSON onLoaded callback failed', cbErr);
                }
            }

            return result;
        }catch(e){
            console.error('Saver.loadJSON failed', e);
            return null;
        }
    }

    static saveJSON = function(object, path = "data.json", options = {}){
        try{
            const defaultName = path || "data.json";
            const filename = prompt("Enter filename to save JSON:", defaultName);
            if(!filename) return false;

            let dataStr = JSON.stringify(object, null, 2);

            // Optionally compact `regions` entries into single-line objects
            if(options && options.compactRegions && object && Array.isArray(object.regions)){
                try{
                    // Build compact JSON for each region
                    const compactRegions = object.regions.map(r => JSON.stringify(r));

                    // Produce a placeholderified copy to locate the property indentation
                    const placeholderKey = "__REGIONS_PLACEHOLDER__";
                    const copy = Object.assign({}, object);
                    delete copy.regions;
                    copy[placeholderKey] = "__REPLACE_ME__";
                    let tmp = JSON.stringify(copy, null, 2);

                    // Find the placeholder line and its indentation + trailing comma
                    const re = new RegExp('^([ \t]*)"' + placeholderKey + '"\\s*:\\s*"__REPLACE_ME__"(,?)\\n','m');
                    const m = tmp.match(re);
                    if(m){
                        const indent = m[1] || '';
                        const trailingComma = m[2] === ',' ? ',' : '';
                        const regionLines = compactRegions.map(r => indent + '  ' + r);
                        const regionsBlock = indent + '"regions": [\n' + regionLines.join(',\n') + '\n' + indent + ']' + trailingComma + '\n';
                        // Replace the placeholder property with the constructed regions block
                        dataStr = tmp.replace(re, regionsBlock);
                    } else {
                        // fallback: leave original pretty JSON
                        dataStr = JSON.stringify(object, null, 2);
                    }
                }catch(e){
                    console.error('Saver.saveJSON compactRegions failed', e);
                    dataStr = JSON.stringify(object, null, 2);
                }
            }

            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(()=>{ try{ URL.revokeObjectURL(url); }catch(e){} }, 1000);
            return true;
        }catch(e){
            console.error('Saver.saveJSON failed', e);
            return false;
        }
    }

    // --- Lock/key persistence helpers ---
    // Store used locks as a map under `locks/used/<lockKey>`.
    // This avoids array growth/duplication and makes lookups O(1).
    markLockUsed(lockKey, autoSave = true) {
        if (typeof lockKey !== 'string' || !lockKey) return;
        try { this.set(`locks/used/${lockKey}`, true, autoSave); } catch (e) {}
    }

    isLockUsed(lockKey) {
        if (typeof lockKey !== 'string' || !lockKey) return false;
        try { return this.get(`locks/used/${lockKey}`, false) === true; } catch (e) { return false; }
    }
}
