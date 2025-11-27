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
        this.size = size.clone();
        this.pos = pos.clone(); // Vector (top-left in world/local coords)
        this.prevPos = pos.clone()
        this.vlos = Vector.zero();
        this.rotation = 0;
        this.Draw = Draw;
        this.destroy = new Signal();
        this.keys = keys || null;
        this.sheet = spriteSheet; // instance of SpriteSheet

        // physics
        this.mass = 5;
        this.restitution = 1.0; // elastic collisions


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
        this.prevPos = this.pos.clone()
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
        // for things like climbing or swimming).
        if (this.keys && !this.envInput) {
            try { this.envInput = new Input(this.keys, 'default', { normalizeDiagonal: false }); } catch (e) { this.envInput = null; }
        }
        if (this.envInput && typeof this.envInput.update === 'function') {
            const edir = this.envInput.update();
            this.envInputDir = (edir && typeof edir.clone === 'function') ? edir.clone() : new Vector(edir.x||0, edir.y||0);
        }

        // simple friction
        this.vlos.x *= this.friction ** delta;
        this.pos.addS(this.vlos);
        // advance animation timer and wrap frames
        this.sheet.updateAnimation(delta)


    }

    adios(){ this.destroy.emit(); }

    draw(levelOffset){
        const drawPos = this.pos.add(levelOffset);
        // Guard against missing currentAnimation (can be null) to avoid runtime errors
        const animName = (this.sheet && this.sheet.currentAnimation && this.sheet.currentAnimation.name) ? this.sheet.currentAnimation.name : null;
        const frame = (this.sheet && typeof this.sheet.currentFrame === 'number') ? this.sheet.currentFrame : 0;
        this.Draw.sheet(this.sheet, drawPos, this.size, animName, frame, this.invert, 1, false);
    }
}

