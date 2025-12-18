import Geometry from '../../modules/Geometry.js';
import Signal from '../../modules/Signal.js';
import Vector from '../../modules/Vector.js';

export default class Menu{
    constructor(mouse,keys,pos,size,layer,color,draggable = false){
        this.pos = pos;
        this.offset = new Vector(0,1)
        this.size = size;
        this.layer = layer;
        this.color = color;
        this.mouse = mouse;
        this.keys = keys;
        this.elements = new Map();
        this.visible = true;
        this.onRemove = new Signal();
        this.draggable = !!draggable;
        this._dragging = false;
        this._dragStartPos = this.pos.clone();
    }
    update(delta){
        if (!this.visible) return;
        for (let [key,element] of this.elements){
            try{ element.update(delta); }catch{}
        }
        const absolutePos = this.pos.add(this.offset);
        if (Geometry.pointInRect(this.mouse.pos, absolutePos, this.size)){
            this.mouse.addMask(1);

            // Start dragging when pressed inside the menu
            if (this.draggable && !this._dragging && this.mouse.pressed('left','popup')){
                console.log('hi')
                this._dragging = true;
                this.mouse.grab(this.mouse.pos);
                this.mouse.focus('popup')
                this._dragStartPos = this.pos.clone();
            }
        }

        // If currently dragging, update position from mouse grab delta
        if (this.draggable && this._dragging){
            try{
                const deltaPos = this.mouse.getGrabDelta();
                this.pos = this._dragStartPos.add(deltaPos);
                // update children offsets to follow new position
                this.elements.forEach((element)=>{
                    try{ element.addOffset(this.pos.add(this.offset)); }catch{}
                })
            }catch{}
        }

        // Release drag when mouse button is released
        if (this.draggable && this._dragging && this.mouse.released('left','popup')){
            try{
                const finalDelta = this.mouse.getGrabDelta();
                this.mouse.unfocus()
                this.pos = this._dragStartPos.add(finalDelta);
                this.mouse.releaseGrab();
            }catch{}
            this._dragging = false;
        }
    }
    draw(Draw){
        if (!this.visible) return;
        Draw.rect(this.pos.add(this.offset),this.size,this.color);
        for (let [key,element] of this.elements){
            try{ element.draw(Draw); }catch{}
        }
        
    }
    addElement(key,element){
        element.addOffset(this.pos)
        try{
            element.onRemove.connect(()=>{
                this.removeElement(key) // for popup-menus
            })
        }catch{}
        this.elements.set(key,element)
    }
    removeElement(key){ 
        const el = this.elements.get(key); 
        if (!el) return; 
        this.elements.delete(key);
    }
    close(){
        this.onRemove.emit()
    }
    addOffset(newOffset){
        this.offset = newOffset
        this.elements.forEach((element)=>{
            element.addOffset(this.pos.add(this.offset))
        })
    }
}