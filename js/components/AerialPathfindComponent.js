import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { pickDefaults,mergeObjects } from "../utils/Support.js";

// Lightweight heuristics
function heuristic(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.hypot(dx, dy);
}
/**
 * More advanced AI for flying enimies
 * 
 *! Dependencies: SheetComponent
 */
export default class AerialPathfindComponent extends Component{
    constructor(entity,data,opts = {}){
        const Dependencies = {
            target:null,
            chunkManager:null,
        }
        super(entity,Dependencies,data)
        this.sheet = entity.getComponent("sheet")
        const defaults = {
            flightSpeed: 1, // Basic flight speed used
            pathRecalc: 0.6,
            attackCooldown: 5.0, // Time between consecutive attack attempts
            
            attackRange: 50, // Range from target to start windup
            detectRange: 70, // Range to try and attack target
            windupDuration: 0.5, // Windup time, conveys the attack before attacking
            swoopDuration: 1.5, // Time before basic movement takes over again

            lungeSpeed: 3, // Velocity given during lunge
            roamRadius: 3, // Radius from current spot to next position
            roamAttempts: 24, // Attempts to find a valid posiiton
        };
        const mergedOpts = mergeObjects(opts,defaults)
        Object.assign(this, mergedOpts)
        // runtime
        this.path = null;
        this.pathIdx = 0;
        this.pathTimer = 0;
        this.gravity = 5;

        this.state = 'default'
        
        this.swoopTimer = 0;
        this.windupTimer = 0;
        this.maxAttackCooldown = 5;
        this.yAccel = 0 // when swooping, this is what makes it flow

        this.roamTarget = null;
    }

    // A* pathfinder adapted from sprite implementations
    findPath(startX, startY, goalX, goalY, maxNodes = 2000) {
        const cm = this.chunkManager;
        const keyOf = (x,y)=>`${x},${y}`;
        const open = new Map();
        const closed = new Set();
        const gScore = new Map();
        const fScore = new Map();
        const cameFrom = new Map();

        const startK = keyOf(startX,startY);
        gScore.set(startK, 0);
        fScore.set(startK, heuristic(startX,startY,goalX,goalY));
        open.set(startK, {x:startX,y:startY});

        let loops = 0;
        while (open.size && loops < maxNodes) {
            loops++;
            let currentK = null, current = null, bestF = Infinity;
            for (const [k,node] of open) {
                const f = fScore.get(k) || Infinity;
                if (f < bestF) { bestF = f; currentK = k; current = node; }
            }
            if (!current) break;
            if (current.x === goalX && current.y === goalY) {
                const path = [];
                let ck = currentK;
                while (ck) {
                    const parts = ck.split(',').map(Number);
                    path.unshift({x: parts[0], y: parts[1]});
                    ck = cameFrom.get(ck);
                }
                return path;
            }
            open.delete(currentK);
            closed.add(currentK);

            for (let dy=-1; dy<=1; dy++){
                for (let dx=-1; dx<=1; dx++){
                    if (dx===0 && dy===0) continue;
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    const nk = keyOf(nx,ny);
                    if (closed.has(nk)) continue;

                    try {
                        const tile = cm.getTileValue(nx, ny);
                        if (tile && tile.type === 'solid') continue;
                        if (dx !== 0 && dy !== 0) {
                            const t1 = cm.getTileValue(current.x + dx, current.y);
                            const t2 = cm.getTileValue(current.x, current.y + dy);
                            if ((t1 && t1.type === 'solid') || (t2 && t2.type === 'solid')) continue;
                        }
                    } catch (e) { }

                    const tentativeG = (gScore.get(currentK) || Infinity) + heuristic(current.x,current.y,nx,ny);
                    const existingG = gScore.get(nk);
                    if (existingG === undefined || tentativeG < existingG) {
                        cameFrom.set(nk, currentK);
                        gScore.set(nk, tentativeG);
                        fScore.set(nk, tentativeG + heuristic(nx,ny,goalX,goalY));
                        if (!open.has(nk)) open.set(nk, {x:nx,y:ny});
                    }
                }
            }
        }
        return null;
    }

    // Choose a roam target reachable within roamRadius
    chooseRoamTarget() {
        const ts = this.chunkManager.noiseTileSize;
        const startX = Math.floor((this.entity.pos.x + this.entity.size.x*0.5) / ts);
        const startY = Math.floor((this.entity.pos.y + this.entity.size.y*0.5) / ts);
        const cm = this.chunkManager;

        const keyOf = (x,y)=>`${x},${y}`;
        const visited = new Set();
        const cameFrom = new Map();
        const q = [];
        visited.add(keyOf(startX,startY));
        q.push({x:startX,y:startY,d:0});

        const candidates = [];
        const maxNodes = Math.max(300, (this.roamAttempts || 24) * 20);
        let nodes = 0;

        while (q.length && nodes < maxNodes) {
            const cur = q.shift(); nodes++;
            if (!(cur.x === startX && cur.y === startY)) {
                try {
                    const t = cm.getTileValue(cur.x, cur.y);
                    if (!t || t.type !== 'solid') candidates.push({x:cur.x,y:cur.y});
                } catch (e) { candidates.push({x:cur.x,y:cur.y}); }
            }
            if (cur.d >= (this.roamRadius || 3)) continue;
            for (let dy=-1; dy<=1; dy++){
                for (let dx=-1; dx<=1; dx++){
                    if (dx===0 && dy===0) continue;
                    const nx = cur.x + dx;
                    const ny = cur.y + dy;
                    const kk = keyOf(nx,ny);
                    if (visited.has(kk)) continue;
                    try {
                        const t = cm.getTileValue(nx, ny);
                        if (t && t.type === 'solid') continue;
                        if (dx !== 0 && dy !== 0) {
                            const t1 = cm.getTileValue(cur.x + dx, cur.y);
                            const t2 = cm.getTileValue(cur.x, cur.y + dy);
                            if ((t1 && t1.type === 'solid') || (t2 && t2.type === 'solid')) continue;
                        }
                    } catch (e) { continue; }
                    visited.add(kk);
                    cameFrom.set(kk, keyOf(cur.x,cur.y));
                    q.push({x:nx,y:ny,d:cur.d+1});
                }
            }
        }

        if (candidates.length === 0) { this.roamTarget = null; return false; }
        const playerCenter = this.target.pos.add(this.target.size.mult(0.5));
        const suitable = candidates.filter(c => {
            if (!playerCenter) return true;
            const px = c.x * ts + ts*0.5;
            const py = c.y * ts + ts*0.5;
            const d = Math.hypot(px - playerCenter.x, py - playerCenter.y);
            return d > ts * 1.2;
        });
        const pool = suitable.length ? suitable : candidates;
        const pick = pool[Math.floor(Math.random() * pool.length)];

        // attempt to reconstruct path via BFS cameFrom first
        const path = [];
        let curKey = keyOf(pick.x, pick.y);
        if (!cameFrom.has(curKey)) {
            const direct = this.findPath(startX, startY, pick.x, pick.y, 1200);
            if (direct && direct.length > 0) {
                this.path = direct; this.pathIdx = 0; this.roamTarget = { x: pick.x, y: pick.y }; this.pathTimer = this.pathRecalc; return true;
            }
            this.roamTarget = null; return false;
        }
        while (curKey && curKey !== keyOf(startX,startY)) {
            const parts = curKey.split(',').map(Number);
            path.unshift({ x: parts[0], y: parts[1] });
            curKey = cameFrom.get(curKey);
        }
        if (path.length === 0) { this.roamTarget = null; return false; }
        this.path = path; this.pathIdx = 0; this.roamTarget = { x: pick.x, y: pick.y }; this.pathTimer = this.pathRecalc; return true;
    }

    _followPath(delta) {
        if (!this.path || this.path.length === 0) return;
        while (this.pathIdx < this.path.length) {
            const node = this.path[this.pathIdx];
            const ts = this.chunkManager.noiseTileSize;
            const target = new Vector(node.x * ts + ts*0.5, node.y * ts + ts*0.5);
            const disp = target.sub(this.entity.pos);
            const dist = Math.hypot(disp.x, disp.y);
            if (dist < Math.max(4, ts*0.3)) { this.pathIdx++; continue; }
            const want = disp.div(dist).mult(this.flightSpeed);
            this.entity.vlos.x += (want.x - this.entity.vlos.x) * Math.min(1, delta * 6);
            this.entity.vlos.y += (want.y - this.entity.vlos.y) * Math.min(1, delta * 6);
            return;
        }
        this.path = null; this.pathIdx = 0;
    }

    update(dt){
        if (!this.entity) return; // ensure this is attached to an object
        if(this.entity.health <=0) return;
        // Face the correct direction
        if (this.entity.vlos.x < -0.1) this.sheet.invert = new Vector(-1, 1);
        else if (this.entity.vlos.x > 0.1) this.sheet.invert = new Vector(1, 1);

        // timers
        this.pathTimer -= dt;
        this.swoopTimer -= dt;
        this.windupTimer -= dt;
        this.attackCooldown -=dt;
        if(this.state!=='windup'){
            this.entity.vlos.y += this.gravity * dt 
            this.entity.vlos.y += this.yAccel * dt
        }
        // Get data
        const player = this.target;
        if (!player) return;
        const pCenter = player.pos.add(player.size.mult(0.5));
        const meCenter = this.entity.pos.add(this.entity.size.mult(0.5));
        const dist = pCenter.distanceTo(meCenter);
        if(dist <= this.attackRange){
            if(this.attackCooldown <= 0 && this.state === 'default') {
                this.state = 'windup'; 
                console.log('hola')
                this.windupTimer = this.windupDuration;
            };
        }else{
            this.yAccel = 0;
        }
        this.windup(dt,pCenter,meCenter)
        if(this.swoopTimer<=0 && this.state === 'swoop'){
            this.state = 'default'
            console.log('back to basic')
            this.attackCooldown = this.maxAttackCooldown
        }

        if(this.state === 'default') {
            this.basicMovement(dt)
            this.entity.vlos.mult(0.8)
            this.entity.vlos.y -= this.gravity * dt / 2
        }
        this.entity.pos.addS(this.entity.vlos.mult(dt))
        this.entity.enablePhysicsUpdate = false;
        if(this.state !== 'windup'){
            this.entity.enablePhysicsUpdate = true;
        }
        this.entity.pos.addS(this.entity.vlos)
        this.entity.vlos.x*=0.98
    }
    windup(dt,pPos,mePos){
        if(this.state !== 'windup') return;
        this.entity.vlos.mult(0);
        if(this.windupTimer < 0){
            this.state = 'swoop';
            console.log('swoop')
            this.swoop(pPos,mePos)
            this.swoopTimer = this.swoopDuration
        }
    }
    swoop(pPos,mePos){
        /**
         * The goal is have it swoop down onto the target position
         * Base equasion: the Kinematic equasion
         * velY = netA*t + vYI (get current y velocity given: net accelertaion, time till return, and the initial y velocity)
         * 
         * We know: t, vYI, g
         * netA in the above equasion is the net y-acceleration, i.e. (gravity + a)) - a = wing force downward
         * 
         * In our case:
         * t = this.swoopDuration
         * vYI = this.lungeSpeed
         * g = this.gravity
         * 
         * Solution:
         * 
         * When the entity is at the vertex, it would have no y velocity in theroy.
         * We know this as the curve it makes is a parabola. This also means it's symmmetric
         * We can substitute velY for 0, and t for t/2:
         * 0 = netA * t/2 + vYI
         * 
         * Then it's basic algeabra
         * 
         * 1. Substract -vYI to both sides: 
         *  netA * t/2 = -vYI
         * 
         * 2. Divide both sides by (t/2): 
         *  netA = (-*vYI)/(t/2)
         * 
         * 3. Simplify: 
         *  netA = (-2*vYI)/t
         * 
         * 4. Substitute netA for (wingA+gravity): 
         *  (wingA+gravity) = (-2*vYI)/t
         * 
         * 5. Subtract gravity from both sides: 
         *  wingA = (-2*vYI)/t - gravity
         * 
         * 
         * Then for the X velocity
         * 
         * By definition, velocity is displacement * time
         * 
         * Since the player is at the vertex, and the entitiy is a point on the parabola: 
         * dX = 2 * (pPos.x - mePos.x)  //multiply by 2 as only subtracting is only to the vertex
         * 
         * Base:
         * velX = dx/t
         * Sustitute:
         * velX = 2*(pPos.x-mePos.x)/t
         * 
         * However, we have an issue. If we add the units:
         * velX(tiles/second) = 2*(pPos.x-mePos.x)/t (pixels/second)
         * The left uses tiles, the right uses pixels
         * 
         * This wasn't an issue for the Y axis as we only used velocities (only tile coords)
         * But here we need to accout for that, divide the right by the tile size in pixels (1 tile = 16px)
         * 
         * velX = (2(pPos.x-mePos)/t)/16
         * 
         * Then simplify:
         * velX = (pPos.x-mePos)/(8*t)
         * 
        */

        this.yAccel = (-2 * this.lungeSpeed) / this.swoopDuration - this.gravity;
        this.entity.vlos.y = this.lungeSpeed
        this.entity.vlos.x = (pPos.x-mePos.x)/(8*this.swoopDuration)
    }

    basicMovement(dt){
        // Get data
        const player = this.target;

        const pCenter = player.pos.add(player.size.mult(0.5));
        const meCenter = this.entity.pos.add(this.entity.size.mult(0.5));
        const dist = pCenter.distanceTo(meCenter);


        if(this.attacking) {
            return;
        }
        if (!this.path || this.pathTimer <= 0) {
            const ts = this.chunkManager.noiseTileSize;
            const sx = Math.floor((this.entity.pos.x + this.entity.size.x*0.5) / ts);
            const sy = Math.floor((this.entity.pos.y + this.entity.size.y*0.5) / ts);

            if (this.attackCooldown > 0) {
                if (!this.roamTarget) this.chooseRoamTarget();
                if (this.roamTarget) {
                    const rx = this.roamTarget.x, ry = this.roamTarget.y;
                    const newPath = this.findPath(sx, sy, rx, ry, 1500);
                    if (newPath && newPath.length > 0) { this.path = newPath; this.pathIdx = 0; }
                    else this.roamTarget = null;
                } else {
                    const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
                    this.entity.vlos.x += (dir.x * this.flightSpeed - this.entity.vlos.x) * Math.min(1, dt*2);
                    this.entity.vlos.y += (dir.y * this.flightSpeed - this.entity.vlos.y) * Math.min(1, dt*2);
                }
            } else {
                const px = Math.floor(pCenter.x / ts); const py = Math.floor(pCenter.y / ts);
                const newPath = this.findPath(sx, sy, px, py, 2000);
                if (newPath && newPath.length > 0) { this.path = newPath; this.pathIdx = 0; this.roamTarget = null; }
                else {
                    const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
                    this.entity.vlos.x += (dir.x * this.flightSpeed - this.entity.vlos.x) * Math.min(1, dt*4);
                    this.entity.vlos.y += (dir.y * this.flightSpeed - this.entity.vlos.y) * Math.min(1, dt*4);
                }
            }
            this.pathTimer = this.pathRecalc;
        }
        this._followPath(dt);
    }

    draw() {
        const Draw = this.sheet.Draw;
        const ts = this.chunkManager.noiseTileSize;
        const p = this.path || null;
        const startIdx = (typeof this.pathIdx === 'number') ? this.pathIdx : 0;
        if (p && p.length) {
            let prev = this.entity.pos.add(this.entity.size.mult(0.5));
            for (let i = startIdx; i < p.length; i++) {
                const node = p[i];
                const nx = node.x * ts + ts * 0.5;
                const ny = node.y * ts + ts * 0.5;
                const next = new Vector(nx, ny);
                Draw.line(prev, next, 'rgba(255, 179, 0, 0.3)', 1);
                prev = next;
            }

            const rt = this.roamTarget || null;
            if (rt) {
                const cx = rt.x * ts + ts * 0.5;
                const cy = rt.y * ts + ts * 0.5;
                Draw.circle(new Vector(cx, cy), Math.max(2, ts * 0.2), 'rgba(255,0,0,0.3)', true);
                Draw.circle(new Vector(cx, cy), Math.max(2, ts * 0.2), 'rgba(255,255,255,0.3)', false, 2);
            }
            if (this.state === 'windup') {
                const playerCenter = this.target.pos.add(this.target.size.mult(0.5));
                const meCenter = this.entity.pos.add(this.entity.size.mult(0.5));
                Draw.line(meCenter, playerCenter, 'rgba(255,0,0,0.5)', 1);
            }
        }
    }

    destroy(){ this.entity = null; this.chunkManager = null; this.scene = null; }

    clone (entity){
        const defaults = {
            flightSpeed: 5, // Basic flight speed used
            pathRecalc: 0.6,
            attackCooldown: 5.0, // Time between consecutive attack attempts
            
            attackRange: 50, // Range from target to start windup
            detectRange: 70, // Range to try and attack target
            windupDuration: 0.5, // Windup time, conveys the attack before attacking
            swoopDuration: 1.5, // Time before basic movement takes over again

            lungeSpeed: 20, // Velocity given during lunge
            roamRadius: 3, // Radius from current spot to next position
            roamAttempts: 24, // Attempts to find a valid posiiton
        };
        const opts = pickDefaults(defaults,this)
        const data = pickDefaults(this.Dependencies,this)
        const cloned = new AerialPathfindComponent(entity,data,opts);
        return cloned;
    }
}
