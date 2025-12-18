import Vector from '../../modules/Vector.js';

export default class UITile {
    constructor(sheet,pos,size,layer,rot=0,invert=new Vector(1,1),opacity=1,smoothing=false){
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
        
    }
    addOffset(offset){
        this.offset = offset
    }
    update(delta){

    }
    draw(Draw){
        if(!this.visible){
            return;
        }
        Draw.tile(this.sheet,this.pos.add(this.offset),this.size,this.tile,this.rot,this.invert,this.opacity,this.smoothing);
    }
}