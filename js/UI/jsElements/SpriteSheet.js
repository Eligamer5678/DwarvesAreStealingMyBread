import Geometry from '../../modules/Geometry.js';
import Vector from '../../modules/Vector.js';

export default class UISpriteSheet {
    /**
     * @param {*} sheet - SpriteSheet instance or base sheet
     * @param {Vector} pos
     * @param {Vector} size
     * @param {number} layer
     * @param {string|number|null} tile - initial animation name or frame index
     * @param {Vector} [invert=new Vector(1,1)]
     * @param {number} [opacity=1]
     * @param {boolean} [smoothing=false]
     * @param {object|null} [mouse=null] - optional mouse manager for draggable behaviour
     * @param {boolean} [draggable=false] - allow dragging when mouse provided
     */
    constructor(sheet, pos, size, layer, tile = null, invert = new Vector(1,1), opacity = 1, smoothing = false, mouse = null, draggable = false){
        this.pos = pos;
        this.size = size;
        this.layer = layer;
        this.offset = new Vector(0,0);
        this.visible = true;

        // Accept either a connected sheet instance or the base SpriteSheet object
        // If it's a factory-like base that exposes `connect`, connect to get per-instance state
        this.baseSheet = sheet;
        this.sheet = sheet.connect();
        this.setAnimation(tile)
        this.tile = tile; // may be animation name or frame index
        this.invert = invert;
        this.opacity = opacity;
        this.smoothing = smoothing;
        // Dragging support
        this.mouse = mouse;
        this.draggable = !!draggable;
        this._dragging = false;
        this.passcode = '';
        this._dragStartPos = this.pos.clone();
        
        // Optional drag bounds: { pos: Vector, size: Vector }
        this.dragBounds = null;
    }

    addOffset(offset){ this.offset = offset }

    setAnimation(name, reset = false){
        if(!this.sheet) return;
        this.sheet.playAnimation(name, reset);
        this.tile = name;
    }

    setFrame(index){
        if(!this.sheet) return;
        this.sheet.currentFrame = index;
        this.tile = index;
    }

    update(delta){
        if(!this.visible) return;
        // Update sheet animation
        try{ this.sheet.updateAnimation(delta); }catch(e){}

        // Drag handling (similar to Menu)
        if (this.mouse && this.draggable) {
            const absolutePos = this.pos.add(this.offset);
            let hovered = false;
            if (Geometry.pointInRect(this.mouse.pos, absolutePos, this.size)){
                hovered = true;
                this.startDrag()
            }
            this.handleDrag()
            
            if(hovered)this.mouse.addMask(1);
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
        if(!this.visible) return;
        if(!this.sheet) return;
        

        // Prefer Draw.sheet when the sheet looks like a SpriteSheet
        const animName = this.sheet.currentAnimation.name;
        const frame = this.sheet.currentFrame;
        Draw.sheet(this.sheet, this.pos.add(this.offset), this.size, animName, frame, this.invert, this.opacity, this.smoothing);
        return;
    }
}
