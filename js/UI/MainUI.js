import Vector from '../modules/Vector.js';
import UIText from './jsElements/Text.js';
import Menu from './jsElements/Menu.js';
import Signal from '../modules/Signal.js';
import Color from '../modules/Color.js';
import UIButton from './jsElements/Button.js'
import UIRect from './jsElements/Rect.js'
import UIImage from './jsElements/Image.js'
import UITile from './jsElements/tile.js'

import InventoryManager from '../managers/InventoryManager.js';
import CraftingManager from '../managers/CraftingManager.js';

/**
 * @typedef {import('../modules/Spritesheet.js').default} SpriteSheetType
 * @typedef {import('../modules/Vector.js').default} VectorType
 * @typedef {import('../modules/Keys.js').default} KeysType
 * @typedef {import('../modules/Mouse.js').default} MouseType
 * @typedef {import('../modules/Draw.js').default} DrawType
 */
export default class MainUI {
    /**
     * @param {DrawType} Draw 
     * @param {MouseType} mouse 
     * @param {KeysType} keys 
     * @param {*} player 
     */
    constructor(Draw,mouse,keys,scene,opts) {
        // General
        this.scene = scene;
        this.player = scene.player;
        this.Draw = Draw;
        this.mouse = mouse;
        this.keys = keys;
        this.opts = opts || {};
        this.visible = true;

        this.colors = {
            'bg': new Color(20,20,20,1,'rgb'),
            'h1': new Color(255,255,255,1,'rgb')
        }
        
        
        this.menu = new Menu(this.mouse,this.keys,new Vector(0,-1),new Vector(0,0),1,this.colors.bg)

        this.createText()
        this.createSlots()
        this.createInventory()
        this.createOther()  

        
    }

    createText(){
        const heightText = new UIText('Height:',new Vector(20,50),1,this.colors.h1,25)
        const heightText2 = new UIText(0,new Vector(110,50),1,this.colors.h1,25)
        const heightText3 = new UIText("Goal: 5000",new Vector(20,90),1,this.colors.h1,25)
        const itemText = new UIText("Selected:",new Vector(20,120),1,this.colors.h1,25)
        this.menu.addElement('heightText',heightText)
        this.menu.addElement('heightText2',heightText2)
        this.menu.addElement('heightText3',heightText3)
        this.menu.addElement('itemText',itemText)
    }
    createSlots(){
        this.slots = ['','','','','']
        const slotOffset = new Vector(30,230)
        const slotSpacing = 30
        const slotSize = 140
        this._slotElems = []
        // load slot background image once
        try {
            this._slotImg = new Image();
            // Use a relative path so the asset resolves correctly on GitHub Pages
            this._slotImg.src = 'Assets/ui/itemslot.png';
        } catch (e) {
            this._slotImg = null;
        }
        // Add UI background
        let bg = new UIRect(new Vector(0,0),new Vector(200,1080),2,'#2c2c2cAA')
        this.menu.addElement('slot-bg',bg)
        // Create five slot elements inside the menu
        for (let i = 0; i < this.slots.length; i++) {
            const x = slotOffset.x; // place under text area
            const y = slotOffset.y + i * (slotSize + slotSpacing);

            // background image (slot graphic)
            const bg = new UIImage(this._slotImg, new Vector(x, y), new Vector(slotSize, slotSize), 2,false);
            this.menu.addElement(`slotBg${i}`, bg);

            // tile renderer (will be updated each frame)
            // try to use tilesheet via resources when available; default to null
            let sheet = null;
            const tile = new UITile(sheet, new Vector(x + 8, y + 8), new Vector(slotSize - 16, slotSize - 16), 2);
            tile.tile = null;
            this.menu.addElement(`slotTile${i}`, tile);

            // selection border rect (hidden by default)
            const border = new UIRect(new Vector(x + 4, y + 4), new Vector(slotSize -8, slotSize -8), 4, '#FFFFFF44',false,true,8,'#00ff22aa');
            border.visible = false;
            this.menu.addElement(`slotBorder${i}`, border);


            this._slotElems.push({ bg, tile, border, x, y, size: slotSize});
        }
    }
    createInventory(){
        // Inventory signals
        this.onToggleInventory = new Signal()
        
        // Inventory button
        const InventoryButton = new UIButton(this.mouse,this.keys,new Vector(40,40),new Vector(120,120),2,'e')
        InventoryButton.onPressed.left.connect(()=>{
            this.onToggleInventory.emit()
        })
        InventoryButton.passcode = "Inventory"
        this.menu.addElement('inventoryButton',InventoryButton)
        
        
        let InventroyImage = new Image();
        InventroyImage.src = 'Assets/ui/bundle.png';
        const InventoryImageElement = new UIImage(InventroyImage, new Vector(50, 50), new Vector(100, 100), 2,false);
        this.menu.addElement(`inventoryButtonImage`, InventoryImageElement);
        
        const resources = (this.scene && this.scene.SpriteImages) ? this.scene.SpriteImages : (this.opts && this.opts.resources ? this.opts.resources : null);
        this.InventoryManager = new InventoryManager(this, resources)
        // register crafting manager and hook player.onCraft to open expanded inventory
        try{ this.CraftingManager = new CraftingManager(); }catch(e){}
        try{ this.InventoryManager.setCraftingManager(this.CraftingManager); }catch(e){}
        // When player uses an anvil (onCraft), open inventory and expand it
        try{
            const player = this.scene.player;
            if (player && player.onCraft) player.onCraft.connect((target,tile)=>{
                try{
                    // open inventory UI in crafting mode; pass meta from recipes if available
                    const meta = { type: (tile && tile.id) ? tile.id : 'anvil', size: [3,3], target };
                    try{ this.InventoryManager.open(meta); }catch(e){}
                }catch(e){}
            })
        }catch(e){}
    }
    // update slot visuals each frame
    _updateSlots() {
        if (!this._slotElems) return;
        const player = this.scene.player;
        for (let i = 0; i < this._slotElems.length; i++) {
            const el = this._slotElems[i];
            // Determine which inventory key is in the hotbar slot and resolve its entry.
            let entry = null;
            try {
                if (player && player.inventory && player.inventory.slots && Array.isArray(player.inventory.slots.hotbar) && i < player.inventory.slots.hotbar.length) {
                    const key = player.inventory.slots.hotbar[i];
                    if (key && player.inventory.Inventory && player.inventory.Inventory.has(key)) {
                        entry = player.inventory.Inventory.get(key);
                    } else if (this.InventoryManager) {
                        // fallback: InventoryManager helper
                        entry = this.InventoryManager.getInventoryEntry ? this.InventoryManager.getInventoryEntry(key) : null;
                    }
                }

            } catch (e) { entry = null; }

            // Apply resolved entry to UITile
            if (entry && entry.sheet) {
                el.tile.sheet = entry.sheet;
                if (entry.data && entry.data.tile) el.tile.tile = entry.data.tile;
                else if (entry.data && entry.data.coord) el.tile.tile = entry.data.coord;
                else el.tile.tile = entry.data && entry.data.id ? entry.data.id : null;
                try { el.tile.data = el.tile.data || {}; el.tile.data.amount = entry.data && entry.data.amount ? entry.data.amount : 0; } catch (e) {}
            } else {
                el.tile.sheet = null; el.tile.tile = null; try { el.tile.data = el.tile.data || {}; el.tile.data.amount = 0; } catch (e) {}
            }

            // highlight currently selected slot (player.selectedIndex)
            if (player.selectedSlot === i) {
                el.border.visible = true;
                el.border.color = '#FFFFFF88';
            } else {
                el.border.visible = false;
            }
        }
    }
    createOther(){
    }

    

    /**
     * Creates a conformation menu
     * (this is a menu example)
     * @param {string} question What's the question?
     * @param {function} yes Function to call when user hits yes
     * @param {function} no Function to call when user hits no (closes by defualt)
     * @param {function} close Function to call instead of closing the conformation menu
    */
    createConformationMenu(question, yes,no,close){   
        const conMenu = new Menu(this.mouse,this.keys,new Vector(1980/2-200,1080/2-100),new Vector(400,200),2,'#2b2b2bff',true)
        
        // Question
        const questionText = new UIText(question?question:"Are you sure?",new Vector(200,40),2,"#FFFFFF",40,{baseline:"middle",align:'center'})
        conMenu.addElement('question',questionText)
        
        // Yes 
        const yesButton = new UIButton(this.mouse,this.keys,new Vector(20,80),new Vector(170,100),3)
        conMenu.addElement('yesButton',yesButton)
        yesButton.onPressed.left.connect(yes?yes:close?close:()=>{
            conMenu.close()
            this.mouse.pause(0.2)
        })
        const yesText = new UIText(question?question:"Yes",new Vector(100,130),2,"#FFFFFF",40,{baseline:"middle",align:'center'})
        conMenu.addElement('yesText',yesText)
        
        // No 
        const noButton = new UIButton(this.mouse,this.keys,new Vector(210,80),new Vector(170,100),3)
        noButton.onPressed.left.connect(no?no:close?close:()=>{
            conMenu.close()
            this.mouse.pause(0.2)
        })
        conMenu.addElement('noButton',noButton)
        const noText = new UIText(question?question:"No",new Vector(300,130),2,"#FFFFFF",40,{baseline:"middle",align:'center'})
        conMenu.addElement('noText',noText)

        return conMenu;
    }


    createAnvilMenu(){
        
    }
    /**
     * Updates the UI
     * @param {number} delta 
     * @returns 
     */
    update(delta) {
        if (!this.visible) return;
        this.InventoryManager.update(delta);
        // keep UI slot visuals in sync with player state
        this.menu.update(delta)
        // update inventory state first so slot counts are current
        this._updateSlots();
    }
    draw() {
        if (!this.visible) return;
        this.menu.draw(this.Draw)
        this.InventoryManager.draw(this.Draw)
    }
}
