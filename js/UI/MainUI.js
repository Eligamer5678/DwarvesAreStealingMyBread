import Vector from '../modules/Vector.js';
import UIText from './jsElements/Text.js';
import Menu from './jsElements/Menu.js';
import Color from '../modules/Color.js';
import UIButton from './jsElements/Button.js'
import UIRect from './jsElements/Rect.js'
import UIImage from './jsElements/Image.js'
import UITile from './jsElements/tile.js'
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
        this.player = (scene && scene.player) ? scene.player : null;
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

        // Prefer resources and player from the passed scene reference
        const resources = this.opts.resources;

        // load slot background image once
        try {
            this._slotImg = new Image();
            this._slotImg.src = '/Assets/ui/itemslot.png';
        } catch (e) {
            this._slotImg = null;
        }

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
            try {
                if (resources && typeof resources.get === 'function') {
                    // leave sheet null; we'll resolve per-tile when updating
                }
            } catch (e) {}
            const tile = new UITile(sheet, new Vector(x + 8, y + 8), new Vector(slotSize - 16, slotSize - 16), 2);
            tile.tile = null;
            this.menu.addElement(`slotTile${i}`, tile);

            // selection border rect (hidden by default)
            const border = new UIRect(new Vector(x + 4, y + 4), new Vector(slotSize -8, slotSize -8), 4, '#FFFFFF44',false,true,8,'#00ff22aa');
            border.visible = false;
            this.menu.addElement(`slotBorder${i}`, border);

            this._slotElems.push({ bg, tile, border, x, y, size: slotSize });
        }
    }

    // update slot visuals each frame
    _updateSlots() {
        if (!this._slotElems) return;
        const resources = (this.scene && this.scene.SpriteImages) ? this.scene.SpriteImages : ((this.opts && this.opts.resources) ? this.opts.resources : null);
        const player = (this.scene && this.scene.player) ? this.scene.player : this.player;
        for (let i = 0; i < this._slotElems.length; i++) {
            const el = this._slotElems[i];
            // determine which block id to show: prefer player's per-slot selection, then fallback to buildPalette
            let bid = null;
            if (player && Array.isArray(player.slots) && i < player.slots.length) bid = player.slots[i];
            else if (player && Array.isArray(player.buildPalette) && i < player.buildPalette.length) bid = player.buildPalette[i];
            // resolve tilesheet and assign to UITile
            if (bid && resources && typeof resources.get === 'function') {
                try {
                    const rblocks = resources.get('blocks');
                    if (rblocks && rblocks instanceof Map && rblocks.has(bid)) {
                        const meta = rblocks.get(bid);
                        const tex = meta.texture;
                        if (tex && tex.tilemap && resources.has(tex.tilemap)) {
                            el.tile.sheet = resources.get(tex.tilemap);
                            el.tile.tile = bid;
                        } else {
                            el.tile.sheet = null;
                            el.tile.tile = null;
                        }
                    } else {
                        el.tile.sheet = null;
                        el.tile.tile = null;
                    }
                } catch (e) {
                    el.tile.sheet = null; el.tile.tile = null;
                }
            } else {
                el.tile.sheet = null; el.tile.tile = null;
            }

            // highlight currently selected slot (player.selectedIndex)
            if (player && typeof player.selectedIndex === 'number' && player.selectedIndex === i) {
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



    update(delta) {
        if (!this.visible) return;
        // keep UI slot visuals in sync with player state
        try { this._updateSlots(); } catch (e) {}
        this.menu.update(delta)
        
    }
    draw() {
        if (!this.visible) return;
        this.Draw.svg("../../Assets/ui/uiTemplet.svg",new Vector(0,0),new Vector(1920,1080))
        this.menu.draw(this.Draw)
    }
}
