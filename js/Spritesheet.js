import Color from './Color.js';
import Signal from './Signal.js';
export default class SpriteSheet{
    constructor(sheet,slicePx,animations = null){
        // `sheet` may be an Image or a Canvas. Internally we maintain per-animation
        // frame canvases in `_frames` and keep `this.sheet` as a packed canvas
        // produced by `_rebuildSheetCanvas()` so Draw.sheet can still be used.
        this.sheet = sheet;
        this.slicePx = slicePx;
        this._frames = new Map(); // animationName -> [canvas, ...]
        // materialization queue for incremental lazy-loading to avoid blocking
        // weak CPUs. Each entry: {animation, index}
        this._materializeQueue = [];
        this._materializeScheduled = false;
        // choose batch size based on hardwareConcurrency when available
        try { this._materializeBatch = Math.max(1, (navigator.hardwareConcurrency ? Math.max(1, Math.floor(navigator.hardwareConcurrency/2)) : 2)); } catch(e){ this._materializeBatch = 2; }
        if(animations){
            this.animations = animations;
        } else {
            this.animations = new Map();
        }
        this.currentAnimation = null;
        this.currentFrame = 0;
        this.updateFrame = true;
        this.onLoop = new Signal();
        this.onStop = new Signal();
        this.onUpdate = new Signal();
        this.onSwap = new Signal();
        this.stacktime = 0;
    }

    /**
     * Create a connected sheet instance.
     * When adding a spritesheet to a sprite, use spritesheet.conenct.
     * What this does is create a spritesheet instance, to make every sprite of the same type use the same image
     * but they are still treated seperate animation wise.
     */
    connect(){
        const host = this;
        // Per-connection signals and state
        const inst = {
            sheet: host.sheet,
            slicePx: host.slicePx,
            animations: host.animations,
            _frames: host._frames,
            _materializeQueue: host._materializeQueue,
            _materializeScheduled: host._materializeScheduled,
            _materializeBatch: host._materializeBatch,

            currentAnimation: null,
            currentFrame: 0,
            updateFrame: true,
            onLoop: new Signal(),
            onStop: new Signal(),
            onUpdate: new Signal(),
            onSwap: new Signal(),
            stacktime: 0,

            addAnimation: function(name,row,frameCount, fps=8, buffer=0, onStop='loop', swapName='idle'){
                // modify animations on host so all instances see the same metadata
                host.addAnimation(name,row,frameCount,fps,buffer,onStop,swapName);
            },

            removeAnimation: function(name){ host.removeAnimation(name); },

            playAnimation: function(name, reset=false){
                this.currentAnimation = this.animations.get(name);
                if(!this.currentAnimation) return;
                if(!reset && this.currentAnimation && name === this.currentAnimation.name) return;
                this.currentFrame = this.currentAnimation.buffer || 0;
                this.updateFrame = true;
            },

            updateAnimation: function(delta){
                if(!this.updateFrame) return;
                if(!this.currentAnimation) return;
                this.stacktime += delta;
                if(this.stacktime < 1/this.currentAnimation.fps) return;
                // subtract interval to reduce drift instead of resetting to zero
                this.stacktime -= 1/this.currentAnimation.fps;
                this.onUpdate.emit();
                this.currentFrame += 1;

                // allow the final frame index (frameCount-1) to be shown
                if(this.currentFrame < this.currentAnimation.frameCount) return;
                if(this.currentAnimation.onStop === 'stop') {
                    this.onStop.emit();
                    this.updateFrame = false; 
                    return;
                }
                if(this.currentAnimation.onStop === 'loop') {
                    this.onLoop.emit();
                    this.currentFrame = this.currentAnimation.buffer || 0; 
                    return;
                }
                if(this.currentAnimation.onStop === 'swapTo'){
                    this.onSwap.emit(this.currentAnimation.swapName);
                    this.playAnimation(this.currentAnimation.swapName);
                    return;
                }
            }
        };

        return inst;
    }
    /**
     * Adds an animtion
     * @param {String} name Name of animation you want to play
     * @param {Number} row Row index of the animation
     * @param {Number} frameCount Number of frames
     * @param {Number} fps Framerate
     * @param {Number} buffer Starting frame index of the animation
     * @param {String} onStop What to do when animation finishes {'loop', 'stop', 'swapTo'}
     * @param {Sting} swapName If onStop is set to swapTo, this is the animation it switches to
     */
    addAnimation(name,row,frameCount, fps=8, buffer=0, onStop='loop', swapName='idle'){
        this.animations.set(name, { name:name,row: row, frameCount: frameCount , fps: fps,buffer: buffer, onStop:onStop, swapName: swapName});
    }
    removeAnimation(name){
        try {
            this.disposeAnimation(name);
        } catch (e) {
            // fallback: at least remove metadata
            try { this.animations.delete(name); } catch (er) {}
        }
    }

    playAnimation(name,reset=false){
        this.currentAnimation = this.animations.get(name);
        if (!this.currentAnimation) return;
        if(!reset && this.currentAnimation && name === this.currentAnimation.name) return;
        this.currentFrame = this.currentAnimation.buffer || 0;
        this.updateFrame = true;
    }

    updateAnimation(delta){
        if(!this.updateFrame) return;
        if(!this.currentAnimation) return;
        this.stacktime += delta;
        if(this.stacktime < 1/this.currentAnimation.fps) return;
        this.stacktime = 0;
        this.onUpdate.emit();
        this.currentFrame += 1;

        if(this.currentFrame < this.currentAnimation.frameCount-1) return;
        if(this.currentAnimation.onStop === 'stop') {
            this.onStop.emit();
            this.updateFrame = false; 
            return;
        }
        if(this.currentAnimation.onStop === 'loop') {
            this.onLoop.emit();
            this.currentFrame = this.currentAnimation.buffer; 
            return;
        }
        if(this.currentAnimation.onStop === 'swapTo'){
            this.onSwap.emit(this.currentAnimation.swapName);
            this.playAnimation(this.currentAnimation.swapName);
            return;
        }

    }
}