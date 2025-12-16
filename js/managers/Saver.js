export default class Saver {
    constructor(storageKey = "gameData") {
        this.storageKey = storageKey;
        this.savedata = {};
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
            localStorage.setItem(this.storageKey, JSON.stringify(this.savedata));
        } catch (e) {
            console.error("Failed to save data:", e);
        }
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
}
