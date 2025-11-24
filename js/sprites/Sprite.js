import Vector from "../Vector.js";
import Signal from "../Signal.js";
import Timer from "../Timer.js";
import Input from './Input.js';
/**
 * @typedef {import('../Spritesheet.js').default} SpriteSheetType
 * @typedef {import('../Input.js').default} InputType
 * @typedef {import('../Vector.js').default} VectorType
 * @typedef {import('../Keys.js').default} KeysType
 * @typedef {import('../Draw.js').default} DrawType
 */

export default class Sprite {
    /**
     * 
     * @param {KeysType} keys 
     * @param {DrawType} Draw 
     * @param {VectorType} pos 
     * @param {VectorType} size 
     * @param {SpriteSheetType} spriteSheet 
     * @param {InputType|Object} inputSettings 
     */
    constructor(keys,Draw,pos,size,spriteSheet,inputSettings){
        // basic state
        this.size = size;                   // Vector (dst draw size in pixels)
        this.pos = pos ? pos.clone() : new Vector(0,0); // Vector (top-left in world/local coords)
        this.vlos = Vector.zero();          // keep velocity available for future physics use
        this.rotation = 0;
        this.Draw = Draw;
        this.destroy = new Signal();
        this.keys = keys || null;

        // physics
        this.mass = 5; // default box is heavier than cat
        this.restitution = 1.0; // elastic collisions

        // animation state (copied from TestSprite)
        this.sheet = spriteSheet; // instance of SpriteSheet
        this.anim = 'base';
        this.animFrame = 0;
        this.animTimer = 0;
        this.animFps = 8; // default fps
        this.animTimer = new Timer("loop", 1/this.animFps);
        this.animTimer.onLoop.connect(()=>{ this.animFrame += 1; });
        this.animTimer.start();

        // basic movement params
        this.invert = new Vector(0,0)
        this.speed = 100;      // acceleration magnitude (px/s^2)
        this.friction = 0.001; // exponential friction base

        // Optional input controller: accept either a pre-built Input instance
        // or an options object to construct one when `keys` was provided.
        this.input = null;
        this.inputDir = new Vector(0,0); // last-read input direction (Vector)
        this.envInput = null; // secondary input manager for environment controls (climb/swim)
        this.envInputDir = new Vector(0,0);
        if (this.keys && inputSettings !== undefined && inputSettings !== null) {
            if (typeof inputSettings.update === 'function') {
                // already an Input-like object
                this.input = inputSettings;
            } else {
                // build an Input controller with provided settings (or default)
                const type = (inputSettings && inputSettings.type) ? inputSettings.type : 'default';
                const opts = (typeof inputSettings === 'object') ? inputSettings : {};
                try { this.input = new Input(this.keys, type, opts); } catch (e) { this.input = null; }
            }
        }
    }

    update(delta){
        // If this sprite has an input controller (player-controlled), apply it.
        // Otherwise treat this as a passive entity and don't call input.
        if (this.input && typeof this.input.update === 'function') {
            const dir = this.input.update();
            // store the input direction so other systems can inspect it
            this.inputDir = (dir && typeof dir.clone === 'function') ? dir.clone() : new Vector(dir.x||0, dir.y||0);
            // accelerate in input direction
            this.vlos.addS(dir.mult(delta).multS(this.speed));
        }

        // Secondary environment input (not used for physics directly but available
        // for things like climbing or swimming). Create lazily when keys are present.
        if (this.keys && !this.envInput) {
            try { this.envInput = new Input(this.keys, 'default', { normalizeDiagonal: false }); } catch (e) { this.envInput = null; }
        }
        if (this.envInput && typeof this.envInput.update === 'function') {
            const edir = this.envInput.update();
            this.envInputDir = (edir && typeof edir.clone === 'function') ? edir.clone() : new Vector(edir.x||0, edir.y||0);
        }

        // simple friction
        this.vlos.x *= this.friction ** delta;

        // advance animation timer and wrap frames
        this.animTimer.update(delta);
        if (this.sheet && this.anim && this.sheet.animations) {
            const meta = this.sheet.animations.get(this.anim);
            if (meta && meta.frameCount) this.animFrame = this.animFrame % meta.frameCount;
        }


        // integrate velocity
        this.pos.addS(this.vlos.clone());
    }

    adios(){ this.destroy.emit(); }

    draw(levelOffset){
        if (this.sheet && this.anim) {
            const drawPos = this.pos.add(levelOffset);
            this.Draw.sheet(this.sheet, drawPos, this.size, this.anim, this.animFrame, this.invert, 1, false);
        }
    }
}

