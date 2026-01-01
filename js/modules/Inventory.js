import {v} from "./Vector.js"
import Saver from "../managers/Saver.js";

export default class Inventory {
    constructor (){
        this.slots = { // elements = itemid
            'hotbar':["","","","",""], // Basic hotbar
            'inventory':new Array(20).fill("")
            // crafting groups (3x3 grid and output slot)
            , 'craft3x3': new Array(9).fill("")
            , 'output': new Array(1).fill("")
        }
        this.Inventory = new Map() //"itemName_itemIndex": slotpath,extra}
        this._nextItemId = 1;
    }

    /**
     * Setup the inventory
     * @param {Object} images The item images
     * @param {Object} blocks The blocks data to be merged with items
     * @param {String} filepath File path of item data (not blocks)
     */
    async startup(images, filepath = "../data/items.json"){
        this.images = images;
        await Saver.loadJSON(filepath, (json) => {this.getItems(json);});
        // Seed starting items if inventory is empty
        try {
            const isEmptySlot = (v) => (v === "" || v === null || v === undefined);
            const hotEmpty = Array.isArray(this.slots.hotbar) ? this.slots.hotbar.every(isEmptySlot) : true;
            const invEmpty = Array.isArray(this.slots.inventory) ? this.slots.inventory.every(isEmptySlot) : true;
            if (hotEmpty && invEmpty && this.Inventory.size === 0) {
                // give the player an anvil in hotbar slot 0 and some stone in inventory
                try { this.addItem('anvil', 'hotbar/0', true, 'inventory', 1); } catch (e){}
                try { this.addItem('stone', 'inventory', false, 'inventory', 16); } catch (e){}
            }
        } catch (e) {}
    }

    getItem(name){
        // Return shape: { sheet, data }
        if (!name) return null;

        // Prefer blocks registry when present
        try {
            if (this.images && this.images instanceof Map) {
                const blocks = this.images.get('blocks');
                if (blocks && blocks instanceof Map && blocks.has(name)) {
                    const b = blocks.get(name);
                    // b.texture -> { tilemap: <key>, pos: [col,row] } or similar
                    const tilemapKey = b.texture && b.texture.tilemap ? b.texture.tilemap : null;
                    if (tilemapKey && this.images.has(tilemapKey)) {
                        const sheet = this.images.get(tilemapKey);
                        const data = Object.assign({}, b.data || {}, { id: name, texture: b.texture, _type: 'block', tile: name });
                        return { sheet, data };
                    }
                    // If tilemap not specified, but tile metadata might be inside tiles of a tilesheet
                    // Try to find a tilesheet that contains this tile name
                    for (const [k, v] of this.images.entries()) {
                        try {
                            if (v && v.tiles) {
                                if (v.tiles instanceof Map) {
                                    if (v.tiles.has(name)) return { sheet: v, data: Object.assign({}, b.data || {}, { id: name, texture: b.texture, _type: 'block', tile: name }) };
                                } else if (v.tiles[name]) {
                                    return { sheet: v, data: Object.assign({}, b.data || {}, { id: name, texture: b.texture, _type: 'block', tile: name }) };
                                }
                            }
                        } catch (e) {}
                    }
                    // fallback: return raw block meta and null sheet
                    return { sheet: null, data: Object.assign({}, b.data || {}, { id: name, texture: b.texture, _type: 'block' }) };
                }
            }

            // Next: direct image/spritesheet lookup by name
            if (this.images && this.images instanceof Map && this.images.has(name)) {
                const sheet = this.images.get(name);
                return { sheet, data: { id: name, _type: 'sheet' } };
            }

            // Lastly: check loaded item definitions from items.json (this.items)
            if (this.items && this.items.items && this.items.items[name]) {
                const def = this.items.items[name];
                const tex = def.texture || {};
                // If texture refers to a sprite/key present in images, return that sheet
                if (tex.item && this.images && this.images instanceof Map && this.images.has(tex.item)) {
                    const sheet = this.images.get(tex.item);
                    const data = Object.assign({}, def.data || {}, { coord: tex.coord || null, id: name, _type: 'item' });
                    return { sheet, data };
                }
                // If coord references a tile inside a tilesheet called 'items' or similar
                if (tex.coord && tex.item && this.images && this.images instanceof Map && this.images.has('items')) {
                    const sheet = this.images.get('items');
                    const data = Object.assign({}, def.data || {}, { coord: tex.coord, id: name, _type: 'item' });
                    return { sheet, data };
                }
                // fallback: return raw definition
                return { sheet: null, data: Object.assign({}, def.data || {}, { id: name, texture: tex, _type: 'item' }) };
            }

        } catch (e) {
            console.warn('Inventory.getItem: error resolving', name, e);
            return { sheet: null, data: { id: name } };
        }

        // Not found
        return null;
    }

    /**
     * Add an item into inventory slots.
     * @param {string} itemname - item id (key used in slots)
     * @param {string} slotPath - e.g. "hotbar/0" or "hotbar" (group only)
     * @param {boolean} replace - when true and placing into a strict indexed slot, overwrite existing and attempt to relocate the kicked item
     * @param {string} kickPath - fallback slot group to attempt to place kicked items (default: "inventory")
     * @returns {boolean} true if item placed (and any kicked items relocated), false if item ended up deleted (no slots available)
     */
    addItem(itemname, slotPath, replace = false, kickPath = "inventory", amount = 1,normalize = false){
        if (!itemname) return false;

        // Create a unique inventory key for this placed item and register metadata
        const itemKey = `${itemname}_${this._nextItemId++}`;
        const resolved = this.getItem(itemname) || { sheet: null, data: { id: itemname } };
        const baseData = Object.assign({}, resolved.data || {});
        baseData.amount = amount;
        this.Inventory.set(itemKey, { slotPath: null, sheet: resolved.sheet, data: baseData });

        // helper: check if slot value is empty
        const isEmpty = (val) => (val === "" || val === null || val === undefined);

        // Normalize a kicked value into an inventory key. If kickedVal is already
        // an inventory key (present in this.Inventory) return it. If it's a plain
        // item name, create a new inventory entry for it and return the new key.
        const normalizeKicked = (kickedVal) => {
            if (!kickedVal) return null;
            if (this.Inventory.has(kickedVal)) return kickedVal;
            // plain item name -> create entry
            const kickedName = kickedVal;
            const kKey = `${kickedName}_${this._nextItemId++}`;
            const kResolved = this.getItem(kickedName) || { sheet: null, data: { id: kickedName } };
            const kbase = Object.assign({}, kResolved.data || {});
            kbase.amount = 1;
            this.Inventory.set(kKey, { slotPath: null, sheet: kResolved.sheet, data: kbase });
            return kKey;
        };

        // helper: try to place an inventory key into a group; if preferIndex provided, try that first
        const placeIntoGroup = (ikey, group, preferIndex = null, allowReplace = false) => {
            const arr = this.slots[group];
            if (!arr || !Array.isArray(arr)) return false;

            // Attempt to merge into existing stacks of the same item in this group first
            if (normalize && this.Inventory.has(ikey)){
                const ikeyEntry = this.Inventory.get(ikey);
                const ikeyName = ikeyEntry && ikeyEntry.data && (ikeyEntry.data.tile || ikeyEntry.data.id || ikeyEntry.data.coord) ? (ikeyEntry.data.tile || ikeyEntry.data.id || ikeyEntry.data.coord) : null;
                if (ikeyName){
                    for (let mi = 0; mi < arr.length; mi++){
                        const slotVal = arr[mi];
                        if (!slotVal || slotVal === ikey) continue;
                        if (this.Inventory.has(slotVal)){
                            const other = this.Inventory.get(slotVal);
                            const otherName = other && other.data && (other.data.tile || other.data.id || other.data.coord) ? (other.data.tile || other.data.id || other.data.coord) : null;
                            if (otherName && otherName === ikeyName){
                                const otherAmt = other.data.amount || 0;
                                if (otherAmt < 64){
                                    const space = 64 - otherAmt;
                                    const move = Math.min(space, ikeyEntry.data.amount || 0);
                                    if (move > 0){
                                        other.data.amount = otherAmt + move;
                                        ikeyEntry.data.amount = (ikeyEntry.data.amount || 0) - move;
                                        // if ikey fully merged, remove it and return success
                                        if ((ikeyEntry.data.amount || 0) <= 0){
                                            if (this.Inventory.has(ikey)) this.Inventory.delete(ikey);
                                            return { placed: true, kicked: null, group, index: mi };
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // if preferIndex specified
            if (preferIndex !== null && preferIndex >= 0 && preferIndex < arr.length) {
                if (isEmpty(arr[preferIndex])) {
                    arr[preferIndex] = ikey;
                    if (this.Inventory.has(ikey)) this.Inventory.get(ikey).slotPath = `${group}/${preferIndex}`;
                    return { placed: true, kicked: null, group, index: preferIndex };
                }
                if (allowReplace) {
                    const kicked = arr[preferIndex];
                    arr[preferIndex] = ikey;
                    if (this.Inventory.has(ikey)) this.Inventory.get(ikey).slotPath = `${group}/${preferIndex}`;
                    return { placed: true, kicked: kicked, group, index: preferIndex };
                }
                // find next empty slot in group
                for (let i = 0; i < arr.length; i++) {
                    if (isEmpty(arr[i])) {
                        arr[i] = ikey;
                        if (this.Inventory.has(ikey)) this.Inventory.get(ikey).slotPath = `${group}/${i}`;
                        return { placed: true, kicked: null, group, index: i };
                    }
                }
                return { placed: false };
            }

            // no preferIndex: find first empty
            for (let i = 0; i < arr.length; i++) {
                if (isEmpty(arr[i])) {
                    arr[i] = ikey;
                    if (this.Inventory.has(ikey)) this.Inventory.get(ikey).slotPath = `${group}/${i}`;
                    return { placed: true, kicked: null, group, index: i };
                }
            }
            return { placed: false };
        };

        // parse slotPath
        let targetGroup = null;
        let targetIndex = null;
        let strictIndex = false;
        if (typeof slotPath === 'string' && slotPath.length > 0) {
            const parts = slotPath.split('/');
            targetGroup = parts[0];
            if (parts.length > 1) {
                const idx = parseInt(parts[1], 10);
                if (!Number.isNaN(idx)) { targetIndex = idx; strictIndex = true; }
            }
        }

        // If no group given, fallback to kickPath as primary
        if (!targetGroup) targetGroup = kickPath;

        // If group doesn't exist, fail fast (try kickPath)
        if (!this.slots[targetGroup] || !Array.isArray(this.slots[targetGroup])) {
            if (this.slots[kickPath] && Array.isArray(this.slots[kickPath])) {
                const r = placeIntoGroup(itemKey, kickPath, null, false);
                if (r.placed) return true;
            }
            // remove created inventory entry since it couldn't be placed
            this.Inventory.delete(itemKey);
            return false;
        }

        // Attempt placement
        if (strictIndex) {
            // strict index specified
            const res = placeIntoGroup(itemKey, targetGroup, targetIndex, !!replace);
            if (res.placed) {
                // handle kicked item if any
                if (res.kicked) {
                    const kickedRaw = res.kicked;
                    const kickedKey = normalizeKicked(kickedRaw);
                    // Try relocate kicked item in same group (first empty)
                    if (kickedKey) {
                        const relocated = placeIntoGroup(kickedKey, targetGroup, null, false);
                        if (relocated.placed) return true;
                        // try kickPath if different
                        if (kickPath && kickPath !== targetGroup && this.slots[kickPath]) {
                            const relocated2 = placeIntoGroup(kickedKey, kickPath, null, false);
                            if (relocated2.placed) return true;
                        }
                        // nowhere to go: delete kicked item and indicate partial failure
                        if (this.Inventory.has(kickedKey)) this.Inventory.delete(kickedKey);
                        console.warn(`Inventory.addItem: kicked item '${kickedRaw}' could not be relocated and was dropped.`);
                        return false;
                    }
                    return false;
                }
                return true;
            }
            // not placed (strict index occupied and replace=false): try find next empty in same group
            const fallback = placeIntoGroup(itemKey, targetGroup, null, false);
            if (fallback.placed) return true;
            // try kickPath
            if (kickPath && this.slots[kickPath]) {
                const res2 = placeIntoGroup(itemKey, kickPath, null, false);
                if (res2.placed) return true;
            }
            // give up -> remove created inventory entry
            this.Inventory.delete(itemKey);
            return false;
        } else {
            // group-only: place into first empty slot in group
            const res = placeIntoGroup(itemKey, targetGroup, null, false);
            if (res.placed) return true;
            // no empty slot in targetGroup: attempt kickPath
            if (kickPath && this.slots[kickPath]) {
                const res2 = placeIntoGroup(itemKey, kickPath, null, false);
                if (res2.placed) return true;
            }
            // all full: if replace==true, replace slot 0 (or index 0) and try to relocate kicked
            if (replace) {
                const kickedRaw = this.slots[targetGroup][0];
                const kickedKey = normalizeKicked(kickedRaw);
                this.slots[targetGroup][0] = itemKey;
                if (this.Inventory.has(itemKey)) this.Inventory.get(itemKey).slotPath = `${targetGroup}/0`;
                if (kickedKey) {
                    // try kickPath
                    if (kickPath && this.slots[kickPath]) {
                        const relocated = placeIntoGroup(kickedKey, kickPath, null, false);
                        if (relocated.placed) return true;
                    }
                    if (this.Inventory.has(kickedKey)) this.Inventory.delete(kickedKey);
                    console.warn(`Inventory.addItem: kicked item '${kickedRaw}' could not be relocated and was dropped.`);
                    return false;
                }
                return true;
            }
            // no place -> remove created inventory entry
            this.Inventory.delete(itemKey);
            return false;
        }
    }

    /**
     * Get the item data
     * @param {Object} json 
     */
    getItems(json){
        this.items = json;
    }

    /**
     * Clear the given slot and remove any associated Inventory entry.
     * @param {string} group
     * @param {number} index
     * @returns {boolean} true if cleared, false otherwise
     */
    clearSlot(group, index){
        if (!group || typeof index !== 'number') return false;
        const grp = this.slots[group];
        if (!grp || !Array.isArray(grp) || index < 0 || index >= grp.length) return false;
        const val = grp[index];
        grp[index] = "";
        // If the slot held an inventory key, remove its entry
        try {
            if (val && typeof val === 'string' && this.Inventory && this.Inventory.has(val)) {
                this.Inventory.delete(val);
            }
        } catch (e) {}
        return true;
    }
}