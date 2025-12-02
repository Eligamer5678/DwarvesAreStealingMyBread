import Vector from '../Vector.js';
import Signal from '../Signal.js';

// Lightweight heuristics
function heuristic(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.hypot(dx, dy);
}

export default class AerialPathfindComponent {
    constructor(opts = {}){
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
        this.opts = Object.assign({}, defaults, opts || {});

        this._entity = null;
        this._manager = null;

        // runtime
        this.path = null;
        this.pathIdx = 0;
        this.pathTimer = 0;
        this.gravity = 5;

        this.state = 'default'
        
        this.swoopTimer = 0;
        this.windupTimer = 0;
        this.attackCooldown = 0;
        this.yAccel = 0 // when swooping, this is what makes it flow

        this.roamTarget = null;
    }

    init(entity, manager){
        this._entity = entity;
        this._manager = manager;
        // expose convenience pointers
        this.scene = (entity && entity.scene) ? entity.scene : (manager && manager.scene) ? manager.scene : null;
        // desync initial timers a bit
        this.attackCooldown = Math.random() * this.opts.attackCooldown;
    }

    // A* pathfinder adapted from sprite implementations
    findPath(startX, startY, goalX, goalY, maxNodes = 2000) {
        const cm = (this.scene && this.scene.chunkManager) ? this.scene.chunkManager : (this._manager && this._manager.chunkManager ? this._manager.chunkManager : null);
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
                        const tile = cm && typeof cm.getTileValue === 'function' ? cm.getTileValue(nx, ny) : null;
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
        const ts = (this.scene && this.scene.noiseTileSize) ? this.scene.noiseTileSize : (this._manager && this._manager.noiseTileSize) ? this._manager.noiseTileSize : 16;
        const startX = Math.floor((this._entity.pos.x + this._entity.size.x*0.5) / ts);
        const startY = Math.floor((this._entity.pos.y + this._entity.size.y*0.5) / ts);
        const cm = this.scene ? this.scene.chunkManager : (this._manager ? this._manager.chunkManager : null);

        const keyOf = (x,y)=>`${x},${y}`;
        const visited = new Set();
        const cameFrom = new Map();
        const q = [];
        visited.add(keyOf(startX,startY));
        q.push({x:startX,y:startY,d:0});

        const candidates = [];
        const maxNodes = Math.max(300, (this.opts.roamAttempts || 24) * 20);
        let nodes = 0;

        while (q.length && nodes < maxNodes) {
            const cur = q.shift(); nodes++;
            if (!(cur.x === startX && cur.y === startY)) {
                try {
                    const t = cm && typeof cm.getTileValue === 'function' ? cm.getTileValue(cur.x, cur.y) : null;
                    if (!t || t.type !== 'solid') candidates.push({x:cur.x,y:cur.y});
                } catch (e) { candidates.push({x:cur.x,y:cur.y}); }
            }
            if (cur.d >= (this.opts.roamRadius || 3)) continue;
            for (let dy=-1; dy<=1; dy++){
                for (let dx=-1; dx<=1; dx++){
                    if (dx===0 && dy===0) continue;
                    const nx = cur.x + dx;
                    const ny = cur.y + dy;
                    const kk = keyOf(nx,ny);
                    if (visited.has(kk)) continue;
                    try {
                        const t = cm && typeof cm.getTileValue === 'function' ? cm.getTileValue(nx, ny) : null;
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
        const playerCenter = this.scene && this.scene.player ? this.scene.player.pos.add(this.scene.player.size.mult(0.5)) : null;
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
                this.path = direct; this.pathIdx = 0; this.roamTarget = { x: pick.x, y: pick.y }; this.pathTimer = this.opts.pathRecalc; return true;
            }
            this.roamTarget = null; return false;
        }
        while (curKey && curKey !== keyOf(startX,startY)) {
            const parts = curKey.split(',').map(Number);
            path.unshift({ x: parts[0], y: parts[1] });
            curKey = cameFrom.get(curKey);
        }
        if (path.length === 0) { this.roamTarget = null; return false; }
        this.path = path; this.pathIdx = 0; this.roamTarget = { x: pick.x, y: pick.y }; this.pathTimer = this.opts.pathRecalc; return true;
    }

    _followPath(delta) {
        if (!this.path || this.path.length === 0) return;
        while (this.pathIdx < this.path.length) {
            const node = this.path[this.pathIdx];
            const ts = (this.scene && this.scene.noiseTileSize) ? this.scene.noiseTileSize : (this._manager && this._manager.noiseTileSize ? this._manager.noiseTileSize : 16);
            const target = new Vector(node.x * ts + ts*0.5, node.y * ts + ts*0.5);
            const disp = target.sub(this._entity.pos);
            const dist = Math.hypot(disp.x, disp.y);
            if (dist < Math.max(4, ts*0.3)) { this.pathIdx++; continue; }
            const want = disp.div(dist).mult(this.opts.flightSpeed);
            this._entity.vlos.x += (want.x - this._entity.vlos.x) * Math.min(1, delta * 6);
            this._entity.vlos.y += (want.y - this._entity.vlos.y) * Math.min(1, delta * 6);
            return;
        }
        this.path = null; this.pathIdx = 0;
    }

    update(dt){
        if (!this._entity) return; // ensure this is attached to an object
        
        // Face the correct direction
        if (this._entity.vlos.x < -0.1) this._entity.invert = new Vector(-1, 1);
        else if (this._entity.vlos.x > 0.1) this._entity.invert = new Vector(1, 1);

        // timers
        this.pathTimer -= dt;
        this.swoopTimer -= dt;
        this.windupTimer -= dt;
        this.attackCooldown -=dt;
        if(this.state!=='windup'){
            this._entity.vlos.y += this.yAccel * dt
            this._entity.vlos.y += this.gravity * dt 
        }
        // Get data
        const player = (this._manager && this._manager.player) ? this._manager.player : (this.scene && this.scene.player ? this.scene.player : null);
        if (!player) return;
        const pCenter = player.pos.add(player.size.mult(0.5));
        const meCenter = this._entity.pos.add(this._entity.size.mult(0.5));
        const dist = pCenter.distanceTo(meCenter);

        if(dist <= this.opts.attackRange && this.attackCooldown <= 0 && this.state === 'default') {
            this.state = 'windup'; 
            console.log('hola')
            this.windupTimer = this.opts.windupDuration;
        };
        this.windup(dt,pCenter,meCenter)
        if(this.swoopTimer<=0 && this.state === 'swoop'){
            this.state = 'default'
            console.log('back to basic')
            this.attackCooldown = this.opts.attackCooldown
        }

        if(this.state === 'default') {
            this.basicMovement(dt)
            this._entity.vlos.mult(0.8)
        }
        this._entity.pos.addS(this._entity.vlos.mult(dt))
        this._entity.enablePhysicsUpdate = false;
        if(this.state !== 'windup'){
            this._entity.enablePhysicsUpdate = true;
        }
    }
    windup(dt,pPos,mePos){
        if(this.state !== 'windup') return;
        this._entity.vlos.mult(0);
        if(this.windupTimer < 0){
            this.state = 'swoop';
            console.log('swoop')
            this.swoop(pPos,mePos)
            this.swoopTimer = this.opts.swoopDuration
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
         * t = this.opts.swoopDuration
         * vYI = this.opts.lungeSpeed
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

        this.yAccel = (-2 * this.opts.lungeSpeed) / this.opts.swoopDuration - this.gravity;
        this._entity.vlos.y = this.opts.lungeSpeed
        this._entity.vlos.x = (pPos.x-mePos.x)/(8*this.opts.swoopDuration)
    }

    basicMovement(dt){

        // Get data
        const player = (this._manager && this._manager.player) ? this._manager.player : (this.scene && this.scene.player ? this.scene.player : null);
        if (!player) return;
        const pCenter = player.pos.add(player.size.mult(0.5));
        const meCenter = this._entity.pos.add(this._entity.size.mult(0.5));
        const dist = pCenter.distanceTo(meCenter);


        if(this.attacking) {
            return;
        }
        if (!this.path || this.pathTimer <= 0) {
            const ts = (this.scene && this.scene.noiseTileSize) ? this.scene.noiseTileSize : (this._manager && this._manager.noiseTileSize ? this._manager.noiseTileSize : 16);
            const sx = Math.floor((this._entity.pos.x + this._entity.size.x*0.5) / ts);
            const sy = Math.floor((this._entity.pos.y + this._entity.size.y*0.5) / ts);

            if (this.attackCooldown > 0) {
                if (!this.roamTarget) this.chooseRoamTarget();
                if (this.roamTarget) {
                    const rx = this.roamTarget.x, ry = this.roamTarget.y;
                    const newPath = this.findPath(sx, sy, rx, ry, 1500);
                    if (newPath && newPath.length > 0) { this.path = newPath; this.pathIdx = 0; }
                    else this.roamTarget = null;
                } else {
                    const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
                    this._entity.vlos.x += (dir.x * this.opts.flightSpeed - this._entity.vlos.x) * Math.min(1, dt*2);
                    this._entity.vlos.y += (dir.y * this.opts.flightSpeed - this._entity.vlos.y) * Math.min(1, dt*2);
                }
            } else {
                const px = Math.floor(pCenter.x / ts); const py = Math.floor(pCenter.y / ts);
                const newPath = this.findPath(sx, sy, px, py, 2000);
                if (newPath && newPath.length > 0) { this.path = newPath; this.pathIdx = 0; this.roamTarget = null; }
                else {
                    const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
                    this._entity.vlos.x += (dir.x * this.opts.flightSpeed - this._entity.vlos.x) * Math.min(1, dt*4);
                    this._entity.vlos.y += (dir.y * this.opts.flightSpeed - this._entity.vlos.y) * Math.min(1, dt*4);
                }
            }
            this.pathTimer = this.opts.pathRecalc;
        }
        this._followPath(dt);
    }

    destroy(){ this._entity = null; this._manager = null; this.scene = null; }
}
