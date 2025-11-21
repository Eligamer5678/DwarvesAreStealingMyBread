import Sprite from './Sprite.js';
import Vector from '../Vector.js';

export default class Slime extends Sprite {
    // Construct with Draw-first signature: (Draw, pos, size, options)
    constructor(Draw, pos = new Vector(0,0), size = new Vector(24,24), options = {}){
        super(Draw, pos, size, null, null);
        this.scene = options.scene || null;
        // accept a spritesheet (prefer explicit, fallback to scene SpriteImages)
        this.sheet = options.sheet || (this.scene && this.scene.SpriteImages && this.scene.SpriteImages.get('slime')) || null;
        if (this.sheet) this.sheet._materializeAnimation && this.sheet._materializeAnimation('walk');
        // ensure attack animation is materialized if present on the sheet
        if (this.sheet) this.sheet._materializeAnimation && this.sheet._materializeAnimation('attack');
        // pick a random speed in px/s between 5 and 12 (user requested 5..15)
        // pick a random speed/acceleration between 5 and 15 (units: px/s or px/s^2)
        const rv = Math.random() * 100;
        // use both as comfortable acceleration magnitude and target px/s
        this.speed = rv;          // acceleration magnitude used by base class (px/s^2)
        this.speedPx = Math.max(50,rv);        // target horizontal speed in px/s
        // give a distinct color
        this.color = options.color || '#55cc55';
        this.radius = Math.min(size.x, size.y) * 0.45;
        // friction and platformer-like physics parameters
        this.friction = 0.01;
        // gravity (px per second^2) and jump speed (px/frame-like)
        // Use values similar to the player so behavior matches
        this.gravity = options.gravity || 30; // px/s^2
        this.jumpSpeed = options.jumpSpeed || 9; // initial jump impulse (px/frame-like)
        // animation default
        this.anim = this.sheet ? 'walk' : 'base';
        // simple mass
        this.mass = 1;
        // attack state
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackCooldown = 0;
        this.attackWindup = options.attackWindup || 0.35; // seconds before lunge (play attack anim)
        this.attackRange = options.attackRange || 48; // pixels
        this.attackSpeed = options.attackSpeed || 250; // px/s lunge speed
        this.attackCooldownTime = options.attackCooldown || 1.2; // seconds between attacks
    }

    update(delta){
        // Basic AI: move toward the player if available
        if (this.scene && this.scene.player) {
            const px = (this.scene.player.pos.x || 0) + (this.scene.player.size.x || 0) * 0.5;
            const py = (this.scene.player.pos.y || 0) + (this.scene.player.size.y || 0) * 0.5;
            const cx = this.pos.x + (this.size.x || 0) * 0.5;
            const cy = this.pos.y + (this.size.y || 0) * 0.5;
            const dx = px - cx;
            const dy = py - cy;
            const dist = Math.hypot(dx, dy) || 1;
            const dirX = dx / dist;
            // horizontal movement toward player (speedPx is px/s -> displacement = speed * delta)
            const desiredX = dirX * this.speedPx * delta;

            // update cooldown timer
            this.attackCooldown = Math.max(0, (this.attackCooldown || 0) - delta);

            // If close enough and cooldown elapsed, start attack windup
            if (!this.isAttacking && this.attackCooldown <= 0 && Math.abs(dx) < this.attackRange && Math.abs(dy) < this.attackRange * 0.75) {
                this.isAttacking = true;
                this.attackTimer = this.attackWindup;
                this.anim = 'attack';
                this.animFrame = 0;
                // hold still during windup
                this.vlos.x = 0;
            }

            // Handle attack state (windup -> lunge)
            if (this.isAttacking) {
                this.attackTimer -= delta;
                if (this.attackTimer > 0) {
                    // still winding up: no horizontal movement, but gravity applies
                    this.vlos.x = 0;
                    this.vlos.y += (this.gravity * delta);
                } else {
                    // perform lunge toward player
                    this.isAttacking = false;
                    this.attackCooldown = this.attackCooldownTime;
                    this.vlos.x = dirX * this.attackSpeed * delta;
                    if (this.onGround) {
                        this.vlos.y = -Math.abs(this.jumpSpeed) * 0.8;
                        this.onGround = false;
                    }
                }
            } else {
                // normal movement and obstacle check
                this.vlos.y += (this.gravity * delta);
                if (this.scene && this.scene.noiseTileSize) {
                    const tsz = this.scene.noiseTileSize || 1;
                    const footY = this.pos.y + (this.size.y || 0) - 1;
                    const footSy = Math.floor(footY / tsz);
                    let probeX;
                    if (desiredX > 0) probeX = this.pos.x + (this.size.x || 0) + desiredX;
                    else if (desiredX < 0) probeX = this.pos.x + desiredX;
                    else probeX = this.pos.x + (this.size.x || 0) * 0.5;
                    const aheadSx = Math.floor(probeX / tsz);
                    const aheadTile = this.scene._getTileValue(aheadSx, footSy);
                    if (aheadTile && aheadTile.type === 'solid') {
                        if(this.onGround) {
                            this.vlos.y = -Math.abs(this.jumpSpeed);
                            this.onGround = false;
                        }
                        this.vlos.x = 30 * Math.sign(dirX || 1);
                    } else {
                        this.vlos.x = desiredX;
                    }
                } else {
                    this.vlos.x = desiredX;
                }
            }

            // animation selection
            const moveSpeed = Math.abs(this.vlos.x || 0);
            const walkThreshold = 0.1;
            if (moveSpeed > walkThreshold && this.onGround) this.anim = 'walk';
            else this.anim = 'idle';
        } else {
            // apply gravity when no target
            this.vlos.y += (this.gravity * delta);
        }

        // call base update to run timers and integrate position
        super.update(delta);
    }

    draw(levelOffset){
        const drawPos = this.pos.add(levelOffset || new Vector(0,0));
        // if a spritesheet is available, draw frame; otherwise fallback to blob
        if (this.sheet) {
            // set facing based on horizontal velocity
            if (this.vlos.x < -0.1) this.invert = new Vector(-1, 1);
            else if (this.vlos.x > 0.1) this.invert = new Vector(1, 1);
            try {
                this.Draw.sheet(this.sheet, drawPos, this.size, this.anim, Math.floor(this.animFrame), this.invert, 1, false);
            } catch (e) {
                // fallback to blob
                const cx = drawPos.x + (this.size.x || 0) * 0.5;
                const cy = drawPos.y + (this.size.y || 0) * 0.5;
                this.Draw.circle(new Vector(cx, cy), this.radius, this.color, true);
            }
        } else {
            // draw a simple slime: outer body and a glossy eye
            const cx = drawPos.x + (this.size.x || 0) * 0.5;
            const cy = drawPos.y + (this.size.y || 0) * 0.5;
            // body
            this.Draw.circle(new Vector(cx, cy), this.radius, this.color, true);
            // glossy highlight
            this.Draw.circle(new Vector(cx - this.radius*0.25, cy - this.radius*0.25), this.radius*0.2, 'rgba(255,255,255,0.6)', true);
            // small eye
            this.Draw.circle(new Vector(cx + this.radius*0.15, cy - this.radius*0.05), this.radius*0.12, '#000000', true);
        }
    }
}
