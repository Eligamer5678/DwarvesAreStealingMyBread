import Signal from "../Signal.js";
import Vector from "../Vector.js";
import Color from "../Color.js";
import Input from './Input.js';
import Timer from "../Timer.js";

/**
 * Cat sprite: drawing + animation logic extracted from TestSprite.
 * Usage matches TestSprite constructor so it can be swapped in easily.
 */
export default class Cat {
    constructor(keys, Draw, pos, size, spriteSheet){
        // basic state
        this.size = size;                   // Vector (dst draw size in pixels)
        this.pos = pos.clone();             // Vector (top-left in world/local coords)
        this.vlos = Vector.zero();          // keep velocity available for future physics use
        this.rotation = 0;
        this.Draw = Draw;
        this.destroy = new Signal();
        this.color = new Color(1,1,1,1);
    // physics
    this.mass = 1; // light creature
    this.restitution = 1.0; // elastic collisions (conserve energy)
        // Render-only adjustments (do not affect physics/collision center)
        this.renderScale = 1/2;                 // ~0.6667 shrink (divide by ~1.5)
        this.renderOffset = new Vector(0, -38); // raise sprite a bit so hitbox aligns visually

        // input (default for now so we can move freely in CollisionScene)
        this.keys = keys;
        this.input = new Input(keys, 'default');
        this.facing = 1; // 1 = right, -1 = left

        // animation state (copied from TestSprite)
        this.sheet = spriteSheet; // instance of SpriteSheet
        this.anim = 'sit';
        this.animFrame = 0;
        this.animTimer = 0;
        this.idleTime = 0;
        this.idleCooldown = 10;
        this.animFps = 8; // default fps
        this.animTimer = new Timer("loop", 1/this.animFps);
        this.animTimer.onLoop.connect(()=>{ this.animFrame += 1; });
        this.animTimer.start();

        // basic movement params
        this.speed = 100;      // acceleration magnitude (px/s^2)
        this.friction = 0.001; // exponential friction base
    }

    update(delta){
        // update input for facing + run/sit state and velocity
        const dir = this.input.update();
        // accelerate in input direction
        this.vlos.addS(dir.mult(delta).multS(this.speed));
        if (Math.sign(dir.x)) {
            this.facing = Math.sign(dir.x);
            this.idleTime = 0;
            // if currently in a constrained anim (e.g., jump/land) keep it, else run
            this.anim = (this.anim === 'jump') ? 'jump' : 'run';
        } else {
            this.idleTime += 1; // simple frame-based idle timer (matches TestSprite style)
        }
        // simple friction
        this.vlos.x *= this.friction ** delta;
        this.vlos.y *= this.friction ** delta;

        // advance animation timer and wrap frames
        this.animTimer.update(delta);
        if (this.sheet && this.anim && this.sheet.animations) {
            const meta = this.sheet.animations.get(this.anim);
            if (meta && meta.frameCount) this.animFrame = this.animFrame % meta.frameCount;
        }

        // idle animation cycle (copied)
        const idleAnimations = [['sit',0],['lick',60],['lick2',120],['sleep',180]];
        for (let anim of idleAnimations){
            if (this.idleTime === 24 * anim[1] + 1) {
                this.anim = anim[0];
                this.animFrame = 0;
            } else if (this.sheet && this.sheet.animations) {
                const meta = this.sheet.animations.get(this.anim);
                if (meta && this.animFrame === meta.frameCount - 1 && this.anim === anim[0] && this.anim !== 'sleep'){
                    this.anim = 'sit';
                }
            }
        }

        // integrate velocity
        this.pos.addS(this.vlos.clone());
    }

    adios(){ this.destroy.emit(); }

    draw(levelOffset){
        if (this.sheet && this.anim) {
            const invert = this.facing < 0 ? { x: -1, y: 1 } : null;
            const s = this.renderScale || 1;
            const drawSize = this.size.mult(s);
            // center the scaled sprite within the original rect, then apply a render offset to raise
            const centerOffset = new Vector((this.size.x - drawSize.x) * 0.5, (this.size.y - drawSize.y) * 0.5);
            const drawPos = this.pos.add(levelOffset).add(centerOffset).add(this.renderOffset);
            this.Draw.sheet(this.sheet, drawPos, drawSize, this.anim, this.animFrame, invert, 1, false);
        }
    }
}
