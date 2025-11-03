// TileMap: maps world tile coordinates to TileSheet references.
// Each cell stores a reference to a tilesheet id and a tile key/index within that sheet.
export default class TileMap {
    constructor() {
        // internal map: key -> { tilesheetId, tileKey }
        // key format: `${x}-${y}`
        this.map = new Map();

        // registered tilesheets: id -> tilesheet object
        // a tilesheet can be any object the renderer understands (Image + slicePx + tiles map, etc.)
        this.tileSheets = new Map();
    }

    _key(x, y) {
        return `${x}|${y}`;
    }

    // Register a tilesheet under an id so map entries can reference it.
    registerTileSheet(id, tileSheetObj) {
        if (!id) throw new Error('registerTileSheet: id required');
        this.tileSheets.set(id, tileSheetObj);
    }

    unregisterTileSheet(id) {
        this.tileSheets.delete(id);
    }

    getTileSheet(id) {
        return this.tileSheets.get(id);
    }

    // Set a tile at integer coordinates x,y. tileKey may be a string name or numeric index
    // tilesheetId refers to a previously registered tilesheet.
    // rotation: integer 0..3 representing 90deg steps (optional, default 0)
    setTile(x, y, tilesheetId, tileKey, rotation = 0, invert=1) {
        const k = this._key(x, y);
        this.map.set(k, { tilesheetId, tileKey, rotation: Number(rotation) || 0 , invert: invert});
    }

    // Get the raw mapping entry for coords (or undefined)
    getTile(x, y) {
        return this.map.get(this._key(x, y));
    }

    // Convenience: return the tilesheet object and tileKey for rendering
    getTileRenderInfo(x, y) {
        const entry = this.getTile(x, y);
        if (!entry) return null;
        const sheet = this.getTileSheet(entry.tilesheetId) || null;
        return { sheet, tileKey: entry.tileKey, tilesheetId: entry.tilesheetId, rotation: entry.rotation ?? 0 , invert: entry.invert ?? 1};
    }

    removeTile(x, y) {
        this.map.delete(this._key(x, y));
    }

    clear() {
        this.map.clear();
    }

    // Iterate over all placed tiles. callback receives (x, y, entry)
    forEach(callback) {
        for (const [k, v] of this.map.entries()) {
            const [xs, ys] = k.split('|');
            const x = parseInt(xs, 10);
            const y = parseInt(ys, 10);
            callback(x, y, v);
        }
    }

    // Return a small serializable object representing the map state.
    // tilesheet objects are not serialized — only their ids. Caller must manage tilesheet registration.
    toJSON() {
        return {
            tiles: Array.from(this.map.entries()), // [["x-y", {tilesheetId, tileKey}], ...]
            tileSheetIds: Array.from(this.tileSheets.keys())
        };
    }

    // Load map state from JSON produced by toJSON(). Note: does not restore tilesheet objects.
    fromJSON(obj) {
        if (!obj) return;
        this.map.clear();
        if (Array.isArray(obj.tiles)) {
            for (const [k, v] of obj.tiles) {
                this.map.set(k, v);
            }
        }
    }
}
