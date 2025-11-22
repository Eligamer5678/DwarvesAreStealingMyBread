import Geometry from '../Geometry.js';

export default class Menu{
    constructor(mouse,keys,pos,size,layer,color){
        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.color = color;
        this.mouse = mouse;
        this.keys = keys;
        this.elements = new Map();
        this.visible = true;
    }
    update(delta){
        if (!this.visible) return;
        for (let [key,element] of this.elements){
            element.update(delta);
        }
        // The scene resets mouse power each tick (mouse.setPower(1)).
        // Menu itself should contribute one mask stack when hovered so that
        // deeper UI elements can increment the mask and prevent clicks from
        // penetrating to elements beneath.
        if (Geometry.pointInRect(this.mouse.pos,this.pos,this.size)){
            try { this.mouse.addMask(1); } catch (e) {}
        }
    }
    draw(Draw){
        if (!this.visible) return;
        Draw.rect(this.pos,this.size,this.color);
        for (let [key,element] of this.elements){
            element.draw(Draw);
        }
        
    }
    addElement(key,element){
        element.addOffset(this.pos)
        this.elements.set(key,element)
    }

}