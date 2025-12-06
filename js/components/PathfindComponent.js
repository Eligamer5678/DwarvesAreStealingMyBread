import Vector from '../modules/Vector.js';

/**
 * PathfindComponent: simple AI that can be attached to an entity to follow
 * the player and perform simple attacks/movement.
 *
 * Options:
 * - type: 'simple' (ground walker) | 'fly' (not implemented yet)
 * - detection: distance to start engaging player
 * - gravity, jumpSpeed, attackRange, attackSpeed, attackCooldown, speed
 */
export default class PathfindComponent {
    constructor(opts = {}){
        this.type = opts.type || 'simple';
        this.detection = Number.isFinite(opts.detection) ? opts.detection : 300;

        // movement / attack parameters with sane defaults
        this.gravity = Number.isFinite(opts.gravity) ? opts.gravity : 5;
        this.jumpSpeed = Number.isFinite(opts.jumpSpeed) ? opts.jumpSpeed : 2;
        this.attackWindup = Number.isFinite(opts.attackWindup) ? opts.attackWindup : 0.6;
        this.attackRange = Number.isFinite(opts.attackRange) ? opts.attackRange : 30;
        this.attackSpeed = opts.attackSpeed || new Vector(3,1);
        this.attackCooldownTime = Number.isFinite(opts.attackCooldown) ? opts.attackCooldown : 1.2;
        this.speed = Number.isFinite(opts.speed) ? opts.speed : 20;

        this._entity = null;
        this._manager = null;

        // runtime state
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackCooldown = 0;
        this.moveCooldown = 0;
    }

    init(entity, manager){
        this._entity = entity;
        this._manager = manager;
        // Allow Slime entity to expose scene-like helper if desired
        // but manager has references we need (player, chunkManager)
        // Hook sheet stop signal so we can unlock animation state after
        // the attack animation finishes. This prevents the attack from
        // being prematurely interrupted or permanently locked.
        try {
            if (this._entity && this._entity.sheet && this._entity.sheet.onStop && typeof this._entity.sheet.onStop.connect === 'function') {
                this._entity.sheet.onStop.connect(() => {
                    try {
                        if (this._entity) {
                            this._entity._animationLocked = false;
                            if (this._entity.sheet && typeof this._entity.sheet.playAnimation === 'function') {
                                this._entity.sheet.playAnimation('idle', true);
                            }
                        }
                    } catch (e) { /* ignore */ }
                });
            }
        } catch (e) { /* ignore hookup errors */ }
    }

    _startAttack(disp){
        if (this.isAttacking) return;
        if (this.attackCooldown > 0) return;
        if (disp.x >= this.attackRange) return;
        if (disp.y >= this.attackRange * 0.75) return;
        this.isAttacking = true;
        this.attackTimer = this.attackWindup;
        // play attack animation if available
        try {
            if (this._entity.sheet && typeof this._entity.sheet.playAnimation === 'function') {
                // lock animations on the entity so other systems don't override while attacking
                try { this._entity._animationLocked = true; } catch (e) {}
                this._entity.sheet.playAnimation('attack', true);
            }
        } catch(e){}
    }

    _handleAttack(delta, dir){
        if (!this.isAttacking) return;
        if (this.attackTimer > 0) { this._entity.vlos.x = 0; return; }
        // perform lunge toward player when grounded
        if (!this._entity.onGround) return;
        this._entity.vlos.y = -Math.abs(this.attackSpeed.y);
        this._entity.onGround = false;
        this.isAttacking = false;
        this.attackCooldown = this.attackCooldownTime;
        this._entity.vlos.x = dir * this.attackSpeed.x;
        this.moveCooldown = 1;
    }

    _move(delta, desired, dir){
        // simple ground movement with obstacle check using chunkManager
        const cm = this._manager && this._manager.chunkManager;
        const tsz = (cm && cm.noiseTileSize) ? cm.noiseTileSize : 16;
        const footY = this._entity.pos.y + this._entity.size.y - 1;
        const footSy = Math.floor(footY / tsz);

        let probeX;
        if (desired.x > 0) probeX = this._entity.pos.x + this._entity.size.x + desired.x;
        else if (desired.x < 0) probeX = this._entity.pos.x + desired.x;
        else probeX = this._entity.pos.x + this._entity.size.x * 0.5;

        const aheadSx = Math.floor(probeX / tsz);
        let aheadTile = null;
        try { if (cm && typeof cm.getTileValue === 'function') aheadTile = cm.getTileValue(aheadSx, footSy); } catch (e) {}
        if (aheadTile && aheadTile.type === 'solid') {
            if (this._entity.onGround) {
                this._entity.vlos.y = -Math.abs(this.jumpSpeed);
                this._entity.onGround = false;
            }
        } else {
            this._entity.vlos.x = desired.x;
        }
    }

    update(dt){
        if (!this._entity || !this._manager) return;
        const player = this._manager.player;
        if (!player) return;

        // basic engage check
        const pPos = player.pos.add(player.size.mult(0.5));
        const cPos = this._entity.pos.add(this._entity.size.mult(0.5));
        const dist = pPos.distanceTo(cPos);
        if (dist > this.detection) return;
        const disp = pPos.sub(cPos);
        const dirVec = disp.div(dist || 1);
        const dirSign = Math.sign(dirVec.x || 0) || 1;
        const desired = dirVec.mult(this.speed).multS(dt);
        const absDisp = { x: Math.abs(disp.x), y: Math.abs(disp.y) };

        // timers
        this.attackCooldown -= dt;
        this.attackTimer -= dt;
        this.moveCooldown -= dt;

        this._startAttack(absDisp);
        this._handleAttack(dt, dirSign);

        // gravity
        this._entity.vlos.y += (this.gravity * dt);
        if (!this.isAttacking && this.moveCooldown < 0) this._move(dt, desired, dirVec);

        if (this._entity.vlos.x < -0.1) this._entity.invert = new Vector(-1,1);
        else if (this._entity.vlos.x > 0.1) this._entity.invert = new Vector(1,1);
    }

    destroy(){
        this._entity = null; this._manager = null;
    }
}
