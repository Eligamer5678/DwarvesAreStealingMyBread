import Vector from '../modules/Vector.js';
import Component from './Component.js';
import { mergeObjects,pickDefaults } from '../utils/Support.js';

/**
 * PathfindComponent: simple AI that can be attached to an entity to follow
 * the target and perform simple attacks/movement.
 * 
 *! Dependencies: SheetComponent
 *
 * Options:
 * - type: 'simple' (ground walker) | 'fly' (not implemented yet)
 * - detection: distance to start engaging target
 * - gravity, jumpSpeed, attackRange, attackSpeed, attackCooldown, speed
 */
export default class PathfindComponent extends Component{
    constructor(entity,data,opts = {}){
        const Dependencies = {
            target:null,
            chunkManager:null,
        }
        const defaults = {
            type:'simple',
            detection:100,
            gravity:5,
            jumpSpeed:2,
            attackWindup:0.6,
            attackRange:30,
            attackSpeed:new Vector(3,1),
            attackCooldownTime: 1.2,
            parryWindow: 2,
            parryStun: 0.45,
            landingFriction: 0.35,
            speed: 20,
        }
        super(entity,Dependencies,data)
        const mergedOpts = mergeObjects(opts,defaults)
        Object.assign(this, mergedOpts)

        this.sheet = entity.getComponent("sheet")
        this.isAttacking = false;
        this.attackTimer = 0;
        this.attackCooldown = 0;
        this.moveCooldown = 0;
    }
    
    setTarget(target){
        this.target = target;
    }

    _startAttack(disp){
        if (this.isAttacking) return;
        if (this.attackCooldown > 0) return;
        if (disp.x >= this.attackRange) return;
        if (disp.y >= this.attackRange * 0.75) return;
        this.isAttacking = true;
        this.attackTimer = this.attackWindup;
        this.sheet.sheet.playAnimation('attack', true);
    }

    _handleAttack(delta, dir){
        if (!this.isAttacking) return;
        if (this.attackTimer > 0) { this.entity.vlos.x = 0; return; }
        // perform lunge toward target when grounded
        if (!this.entity.onGround) return;
        this.entity.vlos.y = -Math.abs(this.attackSpeed.y);
        this.entity.onGround = false;
        this.isAttacking = false;
        this.attackCooldown = this.attackCooldownTime;
        this.entity.vlos.x = dir * this.attackSpeed.x;
        this.moveCooldown = 1;
        this._justLunged = true;
        // Open a short parry window after the attack begins
        try {
            this.entity.parryWindow = Math.max(0, Number(this.parryWindow) || 0.22);
            this.entity.parried = false;
            this.entity.parryAttempted = false;
        } catch (e) {}
    }

    _move(delta, desired, dir){
        // simple ground movement with obstacle check using chunkManager
        const cm = this.chunkManager;
        const tsz = (cm && cm.noiseTileSize) ? cm.noiseTileSize : 16;
        const footY = this.entity.pos.y + this.entity.size.y - 1;
        const footSy = Math.floor(footY / tsz);

        let probeX;
        if (desired.x > 0) probeX = this.entity.pos.x + this.entity.size.x + desired.x;
        else if (desired.x < 0) probeX = this.entity.pos.x + desired.x;
        else probeX = this.entity.pos.x + this.entity.size.x * 0.5;

        const aheadSx = Math.floor(probeX / tsz);
        let aheadTile = null;
        try { if (cm && typeof cm.getTileValue === 'function') aheadTile = cm.getTileValue(aheadSx, footSy); } catch (e) {}
        if (aheadTile && aheadTile.type === 'solid') {
            if (this.entity.onGround) {
                this.entity.vlos.y = -Math.abs(this.jumpSpeed);
                this.entity.onGround = false;
            }
        } else {
            this.entity.vlos.x = desired.x;
        }
    }

    update(dt){
        this.entity.vlos.y += (this.gravity * dt);
        // Tick parry timers
        try {
            if (this.entity.parryWindow > 0) this.entity.parryWindow = Math.max(0, this.entity.parryWindow - dt);
            if (this.entity.parryStun > 0) this.entity.parryStun = Math.max(0, this.entity.parryStun - dt);
        } catch (e) {}

        // Apply landing friction after a lunge
        if (this._justLunged && this.entity.onGround) {
            const lf = Math.max(0, Math.min(1, Number(this.landingFriction) || 0.35));
            this.entity.vlos.x *= lf;
            this._justLunged = false;
        }

        // If stunned from a parry, skip AI logic but keep physics
        if (this.entity.parryStun > 0) {
            this.entity.pos.addS(this.entity.vlos)
            this.entity.vlos.x*=0.98
            return;
        }
        //console.log(this.pos.x)
        if (!this.target) return;
        if(this.entity.health <=0) return;
        
        // basic engage check
        const pPos = this.target.pos.add(this.target.size.mult(0.5));
        const cPos = this.entity.pos.add(this.entity.size.mult(0.5));
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
        if (!this.isAttacking && this.moveCooldown < 0) this._move(dt, desired, dirVec);

        if (this.entity.vlos.x < -0.1) this.sheet.invert = new Vector(-1,1);
        else if (this.entity.vlos.x > 0.1) this.sheet.invert = new Vector(1,1);
        this.entity.pos.addS(this.entity.vlos)
        this.entity.vlos.x*=0.98
    }

    destroy(){
        this.entity = null; this.chunkManager = null;
    }
    /**
     * Clone this component
     * @param {EntityType} entity The entity to attach the clone onto
     * @returns {SheetComponent}
     */
    clone (entity){
        const defaults = {
            type:'simple',
            detection:300,
            gravity:5,
            jumpSpeed:2,
            attackWindup:0.6,
            attackRange:30,
            attackSpeed:new Vector(3,1),
            attackCooldownTime: 1.2,
            parryWindow: 0.22,
            parryStun: 0.45,
            landingFriction: 0.35,
            speed: 20,
        }
        const opts = pickDefaults(defaults,this)
        const data = pickDefaults(this.Dependencies,this)
        const cloned = new PathfindComponent(entity,data,opts);
        return cloned;
    }
}
