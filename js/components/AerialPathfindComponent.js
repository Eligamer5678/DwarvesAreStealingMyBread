import Vector from '../Vector.js';

// Lightweight heuristics
function heuristic(ax, ay, bx, by) {
    const dx = ax - bx, dy = ay - by;
    return Math.hypot(dx, dy);
}

export default class AerialPathfindComponent {
    constructor(opts = {}){
        const defaults = {
            flightSpeed: 5,
            pathRecalc: 0.6,
            attackRange: 30,
            attackCooldown: 2.0,
            attackWindup: 0,
            swoopDuration: 0.5,
            lungeSpeed: 0,
            roamRadius: 3,
            roamAttempts: 24,
        };
        this.opts = Object.assign({}, defaults, opts || {});

        this._entity = null;
        this._manager = null;

        // runtime
        this.path = null;
        this.pathIdx = 0;
        this.pathTimer = 0;
        this.isSwooping = false;
        this.swoopTimer = 0;
        this.isWindingUp = false;
        this.windupTimer = 0;
        this.attackCooldown = 0;
        this.roamTarget = null;
        this._savedFriction = null;
        this._lungeTarget = null;
    }

    init(entity, manager){
        this._entity = entity;
        this._manager = manager;
        // expose convenience pointers
        this.scene = (entity && entity.scene) ? entity.scene : (manager && manager.scene) ? manager.scene : null;
        // desync initial timers a bit
        this.attackCooldown = Math.random() * (this.opts.attackCooldown || 2.0);
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
        if (!this._entity) return;
        const player = (this._manager && this._manager.player) ? this._manager.player : (this.scene && this.scene.player ? this.scene.player : null);
        if (!player) return;

        const pCenter = player.pos.add(player.size.mult(0.5));
        const meCenter = this._entity.pos.add(this._entity.size.mult(0.5));
        const dist = pCenter.distanceTo(meCenter);

        // timers
        this.pathTimer -= dt;
        this.attackCooldown -= dt;
        if (this.isSwooping) {
            this.swoopTimer -= dt;
        }

        // Attack behavior: begin windup if close and not on cooldown
        if (dist <= this.opts.attackRange && this.attackCooldown <= 0 && !this.isWindingUp && !this.isSwooping) {
            // start windup: slow down briefly before the lunge
            this.isWindingUp = true;
            this.windupTimer = this.opts.attackWindup || 0.4;
            try {
                // Do not aggressively zero-out velocity during windup — only
                // raise friction slightly so the enemy appears to brace but
                // doesn't come to a halt. Avoid multiplying vlos (was 0.2)
                // because that makes long windups cancel the lunge.
                this._savedFriction = (this._entity && typeof this._entity.friction === 'number') ? this._entity.friction : null;
                if (this._entity) this._entity.friction = 0.999;
                // snapshot player's position now so the lunge aims at the
                // anticipated location rather than recalculating at lunge time
                try { this._lungeTarget = pCenter.clone ? pCenter.clone() : new Vector(pCenter.x, pCenter.y); } catch (e) { this._lungeTarget = pCenter; }
            } catch (e) {}
        }

        // handle windup -> execute lunge when timer elapses
        if (this.isWindingUp) {
            this.windupTimer -= dt;
            if (this.windupTimer <= 0) {
                this.isWindingUp = false;
                this.isSwooping = true;
                this.swoopTimer = this.opts.swoopDuration || 0.6;
                // set cooldown now to prevent re-trigger during swoop/windup
                this.attackCooldown = this.opts.attackCooldown || 2.0;
                // compute direction toward the stored lunge target (fallback to current player if missing)
                const target = this._lungeTarget || pCenter;
                const toTarget = target.sub(meCenter);
                const td = Math.max(1, Math.hypot(toTarget.x, toTarget.y));
                const dir = toTarget.div(td);
                // base lunge magnitude
                const base = (this.opts.flightSpeed || 1) * (this.opts.lungeSpeed || 1);
                // ensure a minimum burst so short distances still produce a pass-through
                const minBurst = Math.max(base * 0.5, td * 0.5);
                const mag = Math.max(base, minBurst);
                this._entity.vlos.x = dir.x * mag;
                this._entity.vlos.y = dir.y * mag - Math.abs((this.opts.flightSpeed || 1) * 0.4);
                // clear lunge target now that we've used it
                this._lungeTarget = null;
                // Apply one immediate position integration so the lunge moves the
                // entity within the same tick (matches original sprites' behavior).
                try {
                    if (this._entity && typeof this._entity.pos.add === 'function') {
                        this._entity.pos = this._entity.pos.add(this._entity.vlos.mult(dt));
                    }
                } catch (e) { /* ignore */ }
            }
        }

        if (this.isSwooping) {
            // gentle drag while swooping
            this._entity.vlos.x *= 0.98; this._entity.vlos.y *= 0.98;
            if (this.swoopTimer <= 0) {
                this.isSwooping = false;
                // restore friction saved during windup so other motion behaves normally
                try { if (this._entity && this._savedFriction !== null) this._entity.friction = this._savedFriction; } catch (e) {}
                // after finishing swoop, pick a new roam target so enemies desync
                try { this.chooseRoamTarget(); } catch (e) {}
            }
        } else {
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

        // entity's Sprite.update will integrate position; ensure facing
        if (this._entity.vlos.x < -0.1) this._entity.invert = new Vector(-1, 1);
        else if (this._entity.vlos.x > 0.1) this._entity.invert = new Vector(1, 1);
    }

    destroy(){ this._entity = null; this._manager = null; this.scene = null; }
}
