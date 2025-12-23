import Saver from "./Saver.js";
import Signal from "../modules/Signal.js";
import UIButton from "../UI/jsElements/Button.js";
import UIRect from "../UI/jsElements/Rect.js";
import UIText from "../UI/jsElements/Text.js";

export default class CraftingManager{
    constructor(){
        // Load the recipes
        this.recipes = null;
        Saver.loadJSON("../data/recipes.json", (json) => {this.setup(json);});

        this.currentItem = 'null'
        this.onCraft = new Signal()
    }
    setup(json){
        this.recipes = json
    }


    /**
     * Setup the crafting UI (anvil)
     */
    getCraftingUI(menu){

    }
    /**
     * Record the currently-previewed recipe (placeholder shown in UI)
     * @param {object|null} recipe
     */
    setPreview(recipe){
        try{ this.currentPreview = recipe || null; }catch(e){}
    }

    /**
     * Clear any preview/temporary references held by the crafting manager
     */
    clearPreview(){
        try{ this.currentPreview = null; }catch(e){}
    }
    /**
     * Given a 3x3 grid (array of arrays) of item ids (or empty strings/null),
     * attempt to match a recipe. Returns the matching recipe object or null.
     * @param {Array<Array<string>>} grid
     */
    matchGrid(grid){
        try{
            if (!this.recipes || !this.recipes.crafting) return null;
            // Iterate all recipe groups (1x1, 3x3, etc.) and all recipes within
            for (const sizeKey in this.recipes.crafting){
                const list = this.recipes.crafting[sizeKey] || [];
                for (const r of list){
                    const pattern = r.input || [];
                    // Determine pattern bounding box of non-empty cells
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    for (let y = 0; y < pattern.length; y++){
                        const row = pattern[y] || [];
                        for (let x = 0; x < row.length; x++){
                            const need = row[x];
                            if (need !== null && typeof need !== 'undefined' && String(need).trim() !== ''){
                                if (x < minX) minX = x;
                                if (y < minY) minY = y;
                                if (x > maxX) maxX = x;
                                if (y > maxY) maxY = y;
                            }
                        }
                    }
                    // If pattern has no non-empty cells, skip it
                    if (minX === Infinity) continue;
                    const pW = maxX - minX + 1;
                    const pH = maxY - minY + 1;
                    // Normalize pattern into a compact array of size pH x pW
                    const norm = [];
                    for (let y = 0; y < pH; y++){
                        norm[y] = [];
                        for (let x = 0; x < pW; x++){
                            const srcY = minY + y; const srcX = minX + x;
                            const srcRow = pattern[srcY] || [];
                            const v = (typeof srcRow[srcX] === 'string' || typeof srcRow[srcX] === 'number') ? String(srcRow[srcX]) : '';
                            norm[y][x] = v || '';
                        }
                    }
                    // Try all translations of the compact pattern within the 3x3 grid
                    const gridW = 3; const gridH = 3;
                    for (let oy = 0; oy <= gridH - pH; oy++){
                        for (let ox = 0; ox <= gridW - pW; ox++){
                            let ok = true;
                            for (let y = 0; y < pH; y++){
                                for (let x = 0; x < pW; x++){
                                    const need = norm[y][x] || '';
                                    const have = (grid[oy+y] && typeof grid[oy+y][ox+x] !== 'undefined') ? (grid[oy+y][ox+x] || '') : '';
                                    if (need === '') continue; // pattern doesn't require anything here
                                    if (need !== have){ ok = false; break; }
                                }
                                if (!ok) break;
                            }
                            if (ok) return r;
                        }
                    }
                }
            }
        }catch(e){}
        return null;
    }
    
}