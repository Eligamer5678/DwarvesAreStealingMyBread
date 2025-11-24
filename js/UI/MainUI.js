import Vector from '../Vector.js';
import UIButton from './Button.js';
import UIRect from './Rect.js';
import UIText from './Text.js';
import Menu from './Menu.js';
import Color from '../Color.js';
/**
 * @typedef {import('../Spritesheet.js').default} SpriteSheetType
 * @typedef {import('../Vector.js').default} VectorType
 * @typedef {import('../Keys.js').default} KeysType
 * @typedef {import('../Mouse.js').default} MouseType
 * @typedef {import('../Draw.js').default} DrawType
 */
export default class MainUI {
    /**
     * @param {DrawType} Draw 
     * @param {MouseType} mouse 
     * @param {KeysType} keys 
     * @param {*} player 
     */
    constructor(Draw,mouse,keys,player) {
        // General
        this.player = player
        this.Draw = Draw;
        this.mouse = mouse;
        this.keys = keys;
        this.visible = true;

        this.colors = {
            'bg': new Color(20,20,20,1,'rgb'),
            'h1': new Color(255,255,255,1,'rgb')
        }
        this.menu = new Menu(this.mouse,this.keys,new Vector(0,0),new Vector(200,1080),1,this.colors.bg)
        const Text = new UIText('Testabc123',new Vector(50,50),1,this.colors.h1,25)
        this.menu.addElement('header',Text)
    }



    update(delta) {
        if (!this.visible) return;
        this.menu.update(delta)
        
    }

    draw() {
        if (!this.visible) return;
        this.menu.draw(this.Draw)
        
    }
}
