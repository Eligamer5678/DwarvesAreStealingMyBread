import Geometry from '../../modules/Geometry.js';
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
            try{
                if (Geometry.pointInRect(this.mouse.pos, absolutePos, this.size)){
                    hovered = true;
                    if (!this._dragging && this.mouse.pressed('left', this.passcode)){
                        this._dragging = true;
                        try{ this.mouse.grab(this.mouse.pos); }catch(e){}
                        try{ this.mouse.focus('popup'); }catch(e){}
                        this._dragStartPos = this.pos.clone();
                    }
                }
            }catch(e){}

            if (this._dragging){
                try{
                    const deltaPos = this.mouse.getGrabDelta();
                    let newPos = this._dragStartPos.add(deltaPos);
                    // apply drag bounds if present (support startPos or pos keys)
                    const db = this.dragBounds;
                    if (db && (db.startPos || db.pos) && db.size){
                        const sb = db.startPos ? db.startPos : db.pos;
                        const s = db.size;
                        const minX = sb.x;
                        const minY = sb.y;
                        let maxX = sb.x + s.x - this.size.x;
                        let maxY = sb.y + s.y - this.size.y;
                        if (maxX < minX) maxX = minX;
                        if (maxY < minY) maxY = minY;
                        newPos = newPos.clone ? newPos.clone() : newPos;
                        newPos.x = Math.max(minX, Math.min(maxX, newPos.x));
                        newPos.y = Math.max(minY, Math.min(maxY, newPos.y));
                    }
                    this.pos = newPos;
                }catch(e){}
            }

            if (this._dragging && this.mouse.released('left','popup')){
                try{
                    const finalDelta = this.mouse.getGrabDelta();
                    try{ this.mouse.focus(this.passcode); }catch(e){}
                    let finalPos = this._dragStartPos.add(finalDelta);
                    const db = this.dragBounds;
                    if (db && (db.startPos || db.pos) && db.size){
                        const sb = db.startPos ? db.startPos : db.pos;
                        const s = db.size;
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
                    try{ this.mouse.releaseGrab(); }catch(e){}
                }catch(e){}
                this._dragging = false;
            }
            if(hovered) this.mouse.addMask(1)
        }
    }
    draw(Draw){
        if(!this.visible){
            return;
        }
        // If the provided sheet looks like a SpriteSheet (has animations), prefer Draw.sheet
        try {
            if (this.sheet && (this.sheet.animations instanceof Map || (this.sheet.animations && typeof this.sheet.animations === 'object'))) {
                // `this.tile` may be an animation name or frame index; default to 'idle' if not provided
                const anim = (typeof this.tile === 'string') ? this.tile : (this.tile ? String(this.tile) : 'idle');
                const frame = (typeof this.tile === 'number') ? this.tile : 0;
                Draw.sheet(this.sheet, this.pos.add(this.offset), this.size, anim, frame, this.invert, this.opacity, this.smoothing);
                return;
            }
        } catch (e) {
            // fall back to tile rendering below
        }
        Draw.tile(this.sheet,this.pos.add(this.offset),this.size,this.tile,this.rot,this.invert,this.opacity,this.smoothing);
    }
}