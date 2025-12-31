import Geometry from '../../modules/Geometry.js';
import Signal from '../../modules/Signal.js';
import Vector from '../../modules/Vector.js';

export default class UITile {
    constructor(sheet,pos,size,layer,rot=0,invert=new Vector(1,1),opacity=1,smoothing=false, mouse = null, draggable = false){
        this.pos = pos;
        this.size = size;
        this.sheet = sheet;
        this.invert = invert;
        this.rot = rot;
        this.smoothing = smoothing;
        this.opacity = opacity;
        this.offset = new Vector(0,0);
        this.visible = true;
        this.layer = layer;
        // Dragging support
        this.mouse = mouse;
        this.draggable = !!draggable;
        this._dragging = false;
        this.passcode = '';
        this._dragStartPos = this.pos.clone();
        // Optional drag bounds: supports { startPos, size } or { pos, size }
        this.dragBounds = null;
        this.onRelease = new Signal()

        this.data = {amount:1};
        
    }
    addOffset(offset){
        this.offset = offset
    }
    update(delta){
        if(!this.visible) return;
        // Drag handling if enabled
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
        if (this._dragging) return;
        // Allow left OR right to start a drag. Record which button started it
        let btn = null;
        if (this.mouse.pressed('left', this.passcode)) btn = 'left';
        else if (this.mouse.pressed('right', this.passcode)) btn = 'right';
        if (!btn) return;
        this._dragButton = btn;
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
        

        const checkBtn = this._dragButton || 'left';
        if (this.mouse.released(checkBtn,this.hash)){
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
            this.onRelease.emit()
        }
    }

    draw(Draw){
        if(!this.visible || !this.tile)return;
        Draw.tile(this.sheet,this.pos.add(this.offset),this.size,this.tile,this.rot,this.invert,this.opacity,this.smoothing);
        // draw stack amount if present and greater than 1
        try{
            const amt = (this.data && typeof this.data.amount === 'number') ? this.data.amount : 1;
            if (amt >= 1){
                const pad = Math.max(4, Math.floor(Math.min(this.size.x, this.size.y) * 0.08));
                const fontSize = Math.max(10, Math.floor(Math.min(this.size.x, this.size.y) * 0.22));
                const textPos = this.pos.add(this.offset).add(new Vector(this.size.x - pad, this.size.y - pad));
                Draw.text(String(amt), textPos, '#FFFFFF', 2, fontSize, { align: 'right', baseline: 'bottom', font: 'monospace' });
            }
        }catch(e){}
    }
}