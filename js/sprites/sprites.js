import Signal from "../Signal.js";
import Vector from "../Vector.js";
import Geometry from "../Geometry.js";
import Color from "../Color.js";
import Input from './Input.js';

export class TestSprite {
    constructor(keys,Draw,pos,size,spriteSheet){
        this.size = size;
        this.pos = pos.clone();
        this.vlos = Vector.zero()
        this.speed = 100
        this.rotation = Math.random()*2*Math.PI;
        this.Draw = Draw;
        this.destroy = new Signal()
        this.color = new Color(0.5,1,1,1)
        // normalize inputs (WASD / arrows / external joystick)
        this.keys = keys
        this.input = new Input(keys,'platformer');
        // optional spritesheet and animation state
        this.sheet = spriteSheet; // set externally: instance of SpriteSheet
        this.anim = 'sit';
        this.animFrame = 0;
        this.animTimer = 0;
        this.animFps = 8; // default fps for animations
        this.facing = 1; // 1 = right, -1 = left
    // idle tracking (seconds)
    this.idleTimer = 0;
    this.idleLick1 = 60;   // 1 minute
    this.idleLick2 = 120;  // 2 minutes
    this.idleSleep = 180;  // 3 minutes
        // platformer physics
        this.onGround = false;
        this.gravity = 20; // scaled gravity multiplier (applied as vlos.y += gravity * delta)
        this.jumpPower = 10; // impulse applied to vlos.y when jumping (negative to go up)

        // ground / floor handling (can be overridden by scene)
        // default floor at bottom of a 1080p layout (match other code in repo)
        this.groundY = 1080 - this.size.y;

        // listen for jump from platformer Input
        if (this.input && typeof this.input.onJump === 'function') {
            this.input.onJump(() => { this._handleJump(); });
        }
    }
    update(delta){
        // update input and move based on normalized direction
        if (this.input) {
            const dir = this.input.update();
            if (dir && (dir.x !== 0 || dir.y !== 0)) {
                // move position: dir is normalized, scale by speed and delta
                this.vlos.addS(dir.mult(delta).multS(this.speed));
            }
        }
        this.pos.addS(this.vlos)

        //Friction
        this.vlos.x*=0.8

        // apply gravity (vlos is treated as per-second displacement scaled by delta)
        this.vlos.y += this.gravity * delta;

        // move by velocity
        // (pos already updated earlier by this.pos.addS(this.vlos) but ensure ground collision after gravity)
        // clamp to ground
        if (this.pos.y >= this.groundY) {
            this.pos.y = this.groundY;
            this.onGround = true;
            if (this.vlos.y > 0) this.vlos.y = 0;
        } else {
            this.onGround = false;
        }
        if (this.pos.y >= this.groundY-3) {
            this.onGround = true;
        }

        // advance animation timer
        // Animation state machine: only switch to idle/run/sit when on the ground.
        // This prevents mid-air jumps (e.g. 'pounce') from being immediately overridden
        // by horizontal input until the sprite lands again.
        if (this.input && this.onGround) {
            const dir = this.input.dir;
            // Check if the player is holding the "down" keys to make the cat sleep
            const downKeys = (this.input.map && this.input.map.down) ? this.input.map.down : ['s','S','ArrowDown'];
            let downHeld = false;
            for (const k of downKeys) {
                if (this.keys.held && this.keys.held(k)) { downHeld = true; break; }
            }

            // Determine whether the cat is currently 'idle' (on ground, not moving, not holding down)
            const moving = (dir && dir.x !== 0) || Math.abs(this.vlos.x) > 0.5;
            const isIdle = !moving && !downHeld;

            // Update idle timer
            if (isIdle) {
                this.idleTimer += delta;
            } else {
                // reset idle timer on activity (movement, down held, etc.)
                this.idleTimer = 0;
            }

            // Priority: explicit down-held -> immediate sleep
            if (downHeld) {
                if (this.anim !== 'sleep') { this.anim = 'sleep'; this.animFrame = 0; this.animTimer = 0; }
            } else if (this.idleTimer >= this.idleSleep) {
                // cat is tired
                if (this.anim !== 'sleep') { this.anim = 'sleep'; this.animFrame = 0; this.animTimer = 0; }
            } else if (this.idleTimer >= this.idleLick2) {
                // second idle animation
                if (this.anim !== 'lick2') { this.anim = 'lick2'; this.animFrame = 0; this.animTimer = 0; }
            } else if (this.idleTimer >= this.idleLick1) {
                // first idle animation
                if (this.anim !== 'lick') { this.anim = 'lick'; this.animFrame = 0; this.animTimer = 0; }
            } else if (dir && dir.x !== 0) {
                // if moving left/right, face that direction and run
                const newFacing = dir.x < 0 ? -1 : 1;
                if (newFacing !== this.facing) this.facing = newFacing;
                if (this.anim !== 'run') { this.anim = 'run'; this.animFrame = 0; this.animTimer = 0; }
            } else {
                if (this.anim !== 'sit') { this.anim = 'sit'; this.animFrame = 0; this.animTimer = 0; }
            }
        } else { 
            // Not on ground -> reset idle timer
            this.idleTimer = 0;
        }

        if (this.sheet && this.anim) {
            const meta = this.sheet.animations instanceof Map ? this.sheet.animations.get(this.anim) : this.sheet.animations[this.anim];
            const frameCount = meta ? (meta.frameCount ?? meta.frames ?? 1) : 1;
            if (frameCount > 1) {
                this.animTimer += delta;
                const dur = 1 / this.animFps;
                if (this.animTimer >= dur) {
                    const advance = Math.floor(this.animTimer / dur);
                    this.animTimer -= advance * dur;

                    const nonLooping = (meta && meta.loop === false) || this.anim === 'pounce' || this.anim === 'lick' || this.anim === 'lick2';
                    if (nonLooping) {
                        // advance up to the final frame and clamp there
                        if(this.pos.y+this.size.y<1000){
                            this.animFrame = Math.min(this.animFrame + advance, frameCount - 4);
                        }else{
                            this.animFrame = Math.min(this.animFrame + advance, frameCount -1);

                        }
                    } else {
                        // looping animation: wrap around
                        this.animFrame = (this.animFrame + advance) % frameCount;
                    }
                }
            } else {
                this.animFrame = 0;
                this.animTimer = 0;
            }
        }
    }
    adiós(){
        this.destroy.emit();
    }
    draw(){
        if (this.sheet && this.anim) {
            // Draw using Draw.sheet (sheet, pos, size, animation, frame, invert, opacity)
            const invert = this.facing < 0 ? { x: -1, y: 1 } : null;
            this.Draw.sheet(this.sheet, this.pos, this.size, this.anim, this.animFrame, invert, 1, false);
        }
    }

    _handleJump() {
        // only jump if on ground (simple behavior)
        if (this.onGround) {
            this.vlos.y = -Math.abs(this.jumpPower);
            this.onGround = false;
            // switch to pounce animation when jumping
            this.anim = 'pounce';
            this.animFrame = 0;
            this.animTimer = 0;
        }
    }
}

