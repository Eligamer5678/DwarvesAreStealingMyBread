import Signal from "../Signal.js";
import Vector from "../Vector.js";
import Geometry from "../Geometry.js";
import Color from "../Color.js";
import Input from './Input.js';
import Timer from "../Timer.js";

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
        this.keys = keys
        this.input = new Input(keys,'platformer');

        // Animation Logic
        this.sheet = spriteSheet; // set externally: instance of SpriteSheet
        this.anim = 'sit';
        this.animFrame = 0;
        this.animTimer = 0;
        this.idleTime = 0
        this.idleCooldown = 10
        this.animFps = 8; // default fps for animations
        this.animTimer = new Timer("loop",1/this.animFps)
        this.animTimer.onLoop.connect(()=>{this.animFrame+=1})
        this.animTimer.start()
        this.facing = 1; // 1 = right, -1 = left

        // Physics
        this.onGround = false;
        this.coyoteTime = 0.1;
        this.jumpTime = 0
        this.gravity = 20;
        this.jumpPower = 10;
        this.groundY = 1080;
        this.input.onJump.connect(() => {
            this.animFrame = 0
            if(this.jumpTime >= 0) this.vlos.y = -this.jumpPower;
        });
        this.input.onFall.connect(() => {
            this.idleTime = 500
            this.anim = 'sleep'
        })
    }

    update(delta){
        // Basic input
        const dir = this.input.update();
        this.vlos.addS(dir.mult(delta).multS(this.speed));
        if(Math.sign(dir.x)){
            this.facing = Math.sign(dir.x)
            this.idleTime = 0
            this.anim = this.anim === 'jump' ? 'jump' : 'run'
        }else{
            this.idleTime+=1 // frame based for simplicity
        }

        // Physics
        this.vlos.x *= 0.001 ** delta // Friction
        this.vlos.y += this.gravity * delta; // Gravity
        this.jumpTime -= delta
        
        // Ground collision
        if (this.pos.y + this.size.y >= this.groundY) {
            this.pos.y = this.groundY - this.size.y;
            this.onGround = true;
            if (this.vlos.y > 0) this.vlos.y = 0;
        } else {
            this.onGround = false;
        }
        
        if(this.onGround){
            this.jumpTime = this.coyoteTime
            if (this.anim === 'jump' || this.anim === 'land') this.anim = 'sit'
        }
        
        // Animation logic
        this.animTimer.update(delta)
        const meta = this.sheet.animations.get(this.anim)
        this.animFrame = this.animFrame % meta.frameCount
        
        // Jump animation
        if(this.jumpTime > 0 && this.jumpTime !== this.coyoteTime) this.anim = 'jump';
        if(this.anim === 'jump' && this.animFrame >= 3) this.animFrame = 3;
        if(this.anim === 'land' && this.animFrame <= 4) this.animFrame = 4; // same animation as jump but split include landing

        // Idle animations
        const idleAnimations = [['sit',0],['lick',60],['lick2',120],['sleep',180]]
        for (let anim of idleAnimations){
            if(this.idleTime === 24 * anim[1]+1){ 
                this.anim = anim[0]
                this.animFrame = 0
            }
            else if (this.animFrame === meta.frameCount-1 && this.anim === anim[0] && this.anim !== 'sleep'){
                this.anim = 'sit'
            }
        }

        this.pos.addS(this.vlos)
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
}

