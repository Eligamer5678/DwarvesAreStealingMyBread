import Saver from "./Saver.js";
import Signal from "../modules/Signal.js";
import UIButton from "../UI/jsElements/Button.js";
import UIRect from "../UI/jsElements/Rect.js";
import UIText from "../UI/jsElements/Text.js";
import UITile from "../UI/jsElements/tile.js";
import Vector from "../modules/Vector.js";
import Menu from "../UI/jsElements/Menu.js";
import UISpriteSheet from "../UI/jsElements/SpriteSheet.js";

export default class InventoryManager{
    /**
     * @param {*} mainUI MainUI 
     * @param {*} player The player dwarf
     */
    constructor(mainUI, resources = null){
        //get basic components
        this.mainUI = mainUI;
        this.player = this.mainUI.player;
        this.mouse = this.mainUI.mouse;
        this.keys = this.mainUI.keys;
        // resource map (Map) containing tilemaps/sprites/blocks etc.
        this.resources = resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);

        // generate the menu
        this.getInventoryUI()
        this.mainUI.onToggleInventory.connect(()=>{
            this.menu.visible = !this.menu.visible
            if (this.menu.visible) {this.keys.focus('Inventory'); this.mouse.focus("Inventory");}
            if (!this.menu.visible) {this.keys.unfocus(); this.mouse.unfocus();}
        })

        // setup data
        this.selected = {
            "pos":[0,0],
            "type":"",
            "amount":1
        }
    }
    /**
     * Setup the inventory menu
     */
    getInventoryUI(){
        // Create the base menu
        this.menu = new Menu(this.mouse,this.keys,new Vector(320,180),new Vector(980,720),2,"#383838ff",true) // grab data needed from MainUI
        this.menu.passcode = "Inventory"
        this.menu.visible = false;
        this.itemBounds = {
            "pos":new Vector(220,10),
            "size":new Vector(750,700)
        }
        // Create the background for the item display
        const itemBackground = new UIRect(this.itemBounds.pos,this.itemBounds.size,2,"#222222FF")
        itemBackground.mouse = this.mouse;
        itemBackground.mask = true;
        this.menu.addElement('itemBackground',itemBackground)
        
        // Display the player on the UI
        const spriteRect = new UIRect(new Vector(10,10),new Vector(200,200),3,"#000000")
        this.menu.addElement('spriteRect',spriteRect)
        const funnyGuy = new UISpriteSheet(this.player.baseSheet,new Vector(10,10),new Vector(200,200),4,'point')
        funnyGuy.passcode = "Inventory"
        this.menu.addElement('funnyGuy',funnyGuy)


        this.mainUI.menu.addElement('inventory',this.menu)
        // populate with a few random previews
        try{ this.spawnRandomItems(8, new Vector(128,128)); }catch(e){}
    }

    /**
     * Create a UI element for the given item/block name.
     * - If the name corresponds to a block in `this.resources.get('blocks')`, returns a `UITile`
     * - Otherwise if a spritesheet resource exists for the name, returns a `UISpriteSheet`
     * @param {string} name
     * @param {Vector} [pos]
     * @param {Vector} [size]
     * @param {number} [layer]
     * @returns {object|null} UI element (UITile or UISpriteSheet) or null if not found
     */
    getUISpriteFor(name, pos = new Vector(0,0), size = new Vector(16,16), layer = 2, draggable = true){
        // Prefer explicit resources passed into the manager
        const res = this.resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);
        if (!res) return null;

        // If it's a block id and we have a blocks registry, return a UITile
        try{
            if (res.has && res.has('blocks')){
                const blocks = res.get('blocks');
                if (blocks && blocks instanceof Map && blocks.has(name)){
                    const meta = blocks.get(name);
                    const tex = meta.texture;
                    if (tex && tex.tilemap && res.has(tex.tilemap)){
                        const sheet = res.get(tex.tilemap);
                        const t = new UITile(sheet, pos.clone(), size.clone(), layer, 0, new Vector(1,1), 1, false, this.mouse, draggable);
                        t.tile = name;
                        return t;
                    }
                }
            }
        }catch(e){/* ignore and try sprites */}

        // If there's a spritesheet resource with this name, return a UISpriteSheet
        try{
            if (res.has && res.has(name)){
                const s = res.get(name);
                if (s){
                    const ui = new UISpriteSheet(s, pos.clone(), size.clone(), layer, 'idle', new Vector(1,1), 1, false, this.mouse, draggable);
                    return ui;
                }
            }
        }catch(e){}

        return null;
    }

    /**
     * Spawn a number of random items inside the item background area.
     * Spawned items will be clamped to the itemBackground rect.
     * @param {number} count
     * @param {Vector} [itemSize]
     */
    spawnRandomItems(count = 8, itemSize = new Vector(64,64)){
        const bg = this.menu.elements.get('itemBackground');
        if (!bg) return;
        // absolute bounds of background. Prefer `this.itemBounds` when available.
        let absStart, absSize;
        if (this.itemBounds && this.itemBounds.pos && this.itemBounds.size){
            try{ absStart = this.menu.pos.add(this.itemBounds.pos); }catch(e){ absStart = bg.offset.add(bg.pos); }
            absSize = this.itemBounds.size;
        } else {
            absStart = bg.offset.add(bg.pos);
            absSize = bg.size;
        }

        // build candidate list: block ids and sprite keys
        const res = this.resources || (this.mainUI && this.mainUI.scene ? this.mainUI.scene.SpriteImages : null);
        if (!res) return;
        const candidates = [];
        try{
            if (res.has && res.has('blocks')){
                const blocks = res.get('blocks');
                if (blocks && blocks instanceof Map){
                    for (const k of blocks.keys()) candidates.push({ type: 'block', key: k });
                }
            }
        }catch(e){}
        // also include any top-level spritesheets (slicePx present)
        try{
            for (const [k,v] of res){
                if (k === 'blocks') continue;
                if (v && v.slicePx) candidates.push({ type: 'sheet', key: k });
            }
        }catch(e){}

        if (candidates.length === 0) return;

        this.spawnedItems = this.spawnedItems || [];
        for (let i = 0; i < count; i++){
            const pick = candidates[Math.floor(Math.random()*candidates.length)];
            // random position within bounds (absolute)
            const maxX = Math.max(absStart.x, absStart.x + absSize.x - itemSize.x);
            const maxY = Math.max(absStart.y, absStart.y + absSize.y - itemSize.y);
            const rx = absStart.x + Math.floor(Math.random() * Math.max(1, (maxX - absStart.x + 1)));
            const ry = absStart.y + Math.floor(Math.random() * Math.max(1, (maxY - absStart.y + 1)));
            // convert to position relative to menu (menu.addElement will set offset to menu.pos)
            const relX = rx - this.menu.pos.x;
            const relY = ry - this.menu.pos.y;
            const pos = new Vector(relX, relY);

            let element = null;

            element = this.getUISpriteFor(pick.key, pos, itemSize, 3, true);
            if (!element) continue;
            // ensure the UI element has dragBounds clamped to itemBackground
            element.dragBounds = this.itemBounds
            // ensure input context is set so mouse/keys receive the correct passcode
            element.passcode = "Inventory";
            const key = `spawnItem_${Date.now()}_${i}`;
            this.menu.addElement(key, element);
            this.spawnedItems.push({ key, element });
        }
    }
    /**
     * Should update the slots to use the items
     * for blocks: use Tile element, see the slots in MainUI, same way
     * for items: bit more complex, will need to create a new UI component in the jsElements folder for adding a spritesheet to UI
     * 
     * Will need to carry a reference of the block data & item data from main.js/MainUI.js through InventoryManager/MainUI constructers 
     */
    refreshInventory(){

    }
    // For these connect use Signal.connect() on buttons.
    // For example: button.onPressed.left.connect(()=>{console.log('yay')})
    // UIButton also supports toggleing (set triggger property to true/connect to onTrigger()=>(emits state) instead of onPress), which could be better here.
    /**
     * Should select an item
     */
    selectItem(x,y){

    }
    /**
     * Should move an item
     * 
     * How to use the MouseAPI for dragging:
     * 
     * // Starting drag
     * let value = originalPos
     * mouse.grab(mouse.pos) => starts grab
     * previewPos = value.add(mouse.getGrabDelta)
     * 
     * // End drag
     * newPos = previewPos.clone()
     * mouse.releaseGrab() => stops the grab
     * 
     */
    moveItem(x,y){

    }
    
}