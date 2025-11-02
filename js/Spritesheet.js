export default class SpriteSheet{
    constructor(sheet,slicePx,animations = null){
        this.sheet = sheet;
        this.slicePx = slicePx;
        if(animations){
            this.animations = animations
        }else{
            this.animations = new Map()
        }
    }
    addAnimation(name,row,frameCount){
        this.animations.set(name,{'row':row,'frameCount':frameCount})
    }
    removeAnimation(name){
        this.animations.delete(name)
    }
}