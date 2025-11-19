import Vector from "../Vector.js";
import Signal from "../Signal.js";
import Timer from "../Timer.js";
import Input from './Input.js';

// Simple static sprite for editor/runtime entities with a single image
/**
 * Sprite
 * Basic drawable sprite used for simple world entities. The constructor is
 * backwards-compatible and accepts either of these signatures:
 *  - `new Sprite(Draw, pos, size, spriteSheet)`
 *  - `new Sprite(keys, Draw, pos, size, spriteSheet, inputSettings)`
 *
 * If `keys` and `inputSettings` are provided, an `Input` controller will be
 * created and assigned to `this.input`. `inputSettings` may be either an
 * `Input` instance (in which case it is used directly) or an options object
 * passed to `new Input(keys, type, options)`.
 */
export default class Sprite {
    constructor(...args){
        // detect signature: (keys, Draw, pos, size, sheet, inputSettings)
        let keys = null; let Draw = null; let pos = null; let size = null; let spriteSheet = null; let inputSettings = null;
        if (args && args.length && args[0] && (typeof args[0].held === 'function' || typeof args[0].pressed === 'function')) {
            // keys-present form
            keys = args[0]; Draw = args[1]; pos = args[2]; size = args[3]; spriteSheet = args[4]; inputSettings = args[5] || null;
        } else {
            // Draw-first form
            Draw = args[0]; pos = args[1]; size = args[2]; spriteSheet = args[3]; inputSettings = null;
        }

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

