import Sprite from './Sprite.js';
import Vector from '../Vector.js';
import Signal from '../Signal.js';
import { mergeObjects } from '../Support.js';

export default class Slime extends Sprite {
    constructor(Draw, pos = new Vector(0,0), size = new Vector(24,24), sheet = null, options = {}){
        // Sprite expects (keys, Draw, pos, size, spriteSheet, inputSettings)
        // Slime doesn't use keys for input, so pass null
        super(null, Draw, pos, size, sheet, null);
        const defaultSettings = {
            scene:null,
            color:'#55cc55',
            gravity: 30,
            jumpSpeed: 9,
            animFps: 8,
            attackWindup: 1,
            attackRange: 60,
            attackSpeed: new Vector(10,5),
            attackCooldown: 1.2,
            friction: 0.01,
        }
        mergeObjects(options,defaultSettings)

        this.scene = options.scene;
        this.color = options.color;
        this.gravity = options.gravity;
        this.jumpSpeed = options.jumpSpeed;
        this.animFps = options.animFps;
        this.attackWindup = options.attackWindup;
        this.attackRange = options.attackRange;
        this.attackSpeed = options.attackSpeed;
        this.attackCooldownTime = options.attackCooldown;
        this.speed = Math.random() * 100;
        this.friction = 0.01;
        this.anim = 'idle';
        this.mass = 1;
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackCooldown = 0;
        this.moveCooldown = 0;
        this.onAttackFinish = new Signal();
        this.onAttackFinish.connect(()=>{ 
            this.anim = 'walk'; 
            this.animFrame = 0;

        });
    }

    _startAttack(disp){
        // If close enough and cooldown elapsed, start attack windup
        if (this.isAttacking) return;
        const moveSpeed = Math.abs(this.vlos.x);
        // animation selection (don't override attack animation during windup/lunge)
        const walkThreshold = 0.1;
        const desiredAnim = (moveSpeed > walkThreshold && this.onGround) ? 'walk' : 'idle';
        if (desiredAnim !== this.anim) {
            this.anim = desiredAnim;
            this.animFrame = 0;
        }

        if (this.attackCooldown > 0) return;
        if (disp.x >= this.attackRange) return;
        if (disp.y >= this.attackRange * 0.75) return;

        this.isAttacking = true;
        this.attackTimer = this.attackWindup;
        this.anim = 'attack';
        this.animFrame = 0;
    }

    _move(delta,desired,dir){
        // normal movement and obstacle check
        const tsz = this.scene.noiseTileSize;
        const footY = this.pos.y + this.size.y - 1;
        const footSy = Math.floor(footY / tsz);

        let probeX;
        if (desired.x > 0) probeX = this.pos.x + this.size.x + desired.x;
        else if (desired.x < 0) probeX = this.pos.x + desired.x;
        else probeX = this.pos.x + this.size.x * 0.5;

        const aheadSx = Math.floor(probeX / tsz);
        const aheadTile = this.scene._getTileValue(aheadSx, footSy);
        if (aheadTile && aheadTile.type === 'solid') {
            if(this.onGround) {
                this.vlos.y = -Math.abs(this.jumpSpeed);
                this.onGround = false;
            }
        } else {
            this.vlos.x = desired.x;
        }
        return;
    }

    _handleAttack(delta,dir){
        if (!this.isAttacking) return;
        
        // still winding up: no horizontal movement, but gravity applies
        if (this.attackTimer > 0) { this.vlos.x = 0; return;}
        
        // perform lunge toward player
        if (!this.onGround) return; 
        this.vlos.y = -Math.abs(this.attackSpeed.y);
        this.onGround = false; 
        this.isAttacking = false;
        this.attackCooldown = this.attackCooldownTime;
        this.vlos.x =  dir * this.attackSpeed.x;
        this.moveCooldown = 1;
    }


    update(delta){
        const player = this.scene.player
        const pPos = player.pos.add(player.size.mult(0.5))
        const cPos = this.pos.add(this.size.mult(0.5))
        const dist = pPos.distanceTo(cPos) // distance
        const disp = pPos.sub(cPos) // displacment
        const dir = disp.div(dist);
        disp.absS()
        const desired = dir.mult(this.speed).multS(delta)
 
        // update timers
        this.attackCooldown -= delta;
        this.attackTimer -= delta;
        this.moveCooldown -= delta;
        this._startAttack(disp)
        this._handleAttack(delta,Math.sign(dir.x))
        
        // Movement
        this.vlos.y += (this.gravity * delta);
        if(!this.isAttacking && this.moveCooldown < 0) this._move(delta,desired,dir)


        // call base update to run timers and integrate position (this advances animFrame)
        // store previous anim/frame for detection of animation wrap (used to detect attack finish)
        const prevAnim = this.anim;
        const prevFrame = this.animFrame;

        super.update(delta);


        // detect end of attack animation: previous frame was last frame and now wrapped to 0
        if (this.anim === 'attack' && prevAnim === 'attack') {
            const meta = this.sheet.animations.get('attack') || null;
            const frameCount = meta.frameCount;
            if (frameCount > 0 && prevFrame === frameCount - 1 && this.currentFrame === 0) {
                this.onAttackFinish.emit();
            }
        }
    }

    draw(levelOffset){
        const drawPos = this.pos.add(levelOffset);
        if (this.vlos.x < -0.1) this.invert = new Vector(-1, 1);
        else if (this.vlos.x > 0.1) this.invert = new Vector(1, 1);
        this.Draw.sheet(this.sheet, drawPos, this.size, this.anim, Math.floor(this.animFrame), this.invert, 1, false);
    }
}
