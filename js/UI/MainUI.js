import Vector from '../modules/Vector.js';
import UIText from './jsElements/Text.js';
import Menu from './jsElements/Menu.js';
import Color from '../modules/Color.js';
import UIButton from './jsElements/Button.js'
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
        const heightText = new UIText('Height:',new Vector(20,50),1,this.colors.h1,25)
        const heightText2 = new UIText(0,new Vector(110,50),1,this.colors.h1,25)
        const heightText3 = new UIText("Goal: 5000",new Vector(20,90),1,this.colors.h1,25)
        const itemText = new UIText("Selected:",new Vector(20,120),1,this.colors.h1,25)

        const testButton = new UIButton(this.mouse,this.keys,new Vector(0,250),new Vector(100,100),2)
        testButton.onPressed.left.connect(()=>{
            const popUp = new Menu(this.mouse,this.keys,new Vector(1980/2-200,1080/2-100),new Vector(100,200),2,'#FF0000',true)
            this.menu.addElement('popup',popUp)
        })
        this.menu.addElement('heightText',heightText)
        this.menu.addElement('heightText2',heightText2)
        this.menu.addElement('heightText3',heightText3)
        this.menu.addElement('itemText',itemText)
        this.menu.addElement('testButton',testButton)
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
