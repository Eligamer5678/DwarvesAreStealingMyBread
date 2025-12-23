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
        this.maskMouse = false;
        this.keys = keys;
        this.elements = new Map();
        this.visible = true;
        this.onRemove = new Signal();
        this.draggable = !!draggable;
        this._dragging = false;
        this.passcode = ""
        this._dragStartPos = this.pos.clone();
    }
    update(delta){
        if (!this.visible) return;
        const elementsArr = Array.from(this.elements.values()).reverse();
        for (let element of elementsArr){
            try{ element.update(delta); }catch{}
        }

        if (this.mouse && this.draggable){
            let hovered = false;
            const absolutePos = this.pos.add(this.offset);
            if (Geometry.pointInRect(this.mouse.pos, absolutePos, this.size)){
                hovered = true;
                this.startDrag()
            }
            this.handleDrag()
            if(hovered) this.mouse.addMask(1)
        }
    }
    startDrag(){
        if (this._dragging || !this.mouse.pressed('left', this.passcode)) return;
        this.hash = Math.random()
        this._dragging = true;
        try{ this.mouse.grab(this.mouse.pos); }catch(e){}
        try{ this.mouse.focus(this.hash); }catch(e){}
        this._dragStartPos = this.pos.clone();
        
    }
    handleDrag(){
        if(!this._dragging) return;

        const deltaPos = this.mouse.getGrabDelta();
        let newPos = this._dragStartPos.add(deltaPos);
        // apply drag bounds if present (support either {pos,size} or {startPos,size})
        const db = this.dragBounds;
        if (db && (db.pos || db.startPos) && db.size){
            const sb = db.startPos ? db.startPos : db.pos;
            const s = db.size;
            const minX = sb.x;
            const minY = sb.y;
            let maxX = sb.x + s.x - this.size.x;
            let maxY = sb.y + s.y - this.size.y;
            if (maxX < minX) maxX = minX;
            if (maxY < minY) maxY = minY;
            const clampedX = Math.max(minX, Math.min(maxX, newPos.x));
            const clampedY = Math.max(minY, Math.min(maxY, newPos.y));
            newPos = newPos.clone ? newPos.clone() : newPos;
            newPos.x = clampedX; newPos.y = clampedY;
        }
        this.pos = newPos;
        this.elements.forEach((element)=>{
            try{ element.addOffset(this.pos.add(this.offset)); }catch{}
        })
        

        if (this.mouse.released('left',this.hash)){
            const finalDelta = this.mouse.getGrabDelta();
            this.mouse.focus(this.passcode);
            let finalPos = this._dragStartPos.add(finalDelta);
            // apply drag bounds if present (support either {pos,size} or {startPos,size})
            const db2 = this.dragBounds;
            if (db2 && (db2.pos || db2.startPos) && db2.size){
                const sb = db2.startPos ? db2.startPos : db2.pos;
                const s = db2.size;
                const minX = sb.x;
                const minY = sb.y;
                let maxX = sb.x + s.x - this.size.x;
                let maxY = sb.y + s.y - this.size.y;
                if (maxX < minX) maxX = minX;
                if (maxY < minY) maxY = minY;
                finalPos.x = Math.max(minX, Math.min(maxX, finalPos.x));
                finalPos.y = Math.max(minY, Math.min(maxY, finalPos.y));
            }
            this.pos = finalPos;
            this.mouse.releaseGrab();
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