import Sprite from './Sprite.js';
import Vector from '../Vector.js';
import { mergeObjects } from '../Support.js';

// Lightweight A* for tile grid pathfinding (8-way)
function heuristic(ax, ay, bx, by) {
    // Euclidean
    const dx = ax - bx, dy = ay - by;
    return Math.hypot(dx, dy);
}

export default class Moth extends Sprite {
    constructor(Draw, pos = new Vector(0,0), size = new Vector(16,16), sheet = null, options = {}){
        // Sprite expects (keys, Draw, pos, size, spriteSheet, inputSettings)
        super(null, Draw, pos, size, sheet, null);
        const defaults = {
            scene: null,
            flightSpeed: 10,
            pathRecalc: 0.6,
            attackRange: 30,
            attackCooldown: 2.0
        };
        mergeObjects(options, defaults);

        this.scene = options.scene;
        this.speed = options.flightSpeed;
        this.pathRecalc = options.pathRecalc;
        this.attackRange = options.attackRange;
        this.attackCooldownTime = options.attackCooldown;

        this.path = null; // array of tile nodes [ {x,y}, ... ]
        this.pathIdx = 0;
        this.pathTimer = 0;

        this.isSwooping = false;
        this.swoopTimer = 0;
        this.attackCooldown = 0;

        // roaming between attacks
        this.roamTarget = null; // {x,y} tile coords
        this.roamRadius = 3; // tiles (smaller radius for reachable targets)
        this.roamAttempts = 24;

        // desynchronize initial attack timers so moths don't all swoop together
        this.attackCooldown = Math.random() * this.attackCooldownTime;
        this.onGround = false;
        this.sheet.playAnimation('fly')
    }

    // Simple A* on the tile grid. Limits nodes to avoid runaway CPU.
    findPath(startX, startY, goalX, goalY, maxNodes = 2000) {
        const cm = this.scene.chunkManager;
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
            // pick node in open with lowest fScore
            let currentK = null, current = null, bestF = Infinity;
            for (const [k,node] of open) {
                const f = fScore.get(k) || Infinity;
                if (f < bestF) { bestF = f; currentK = k; current = node; }
            }
            if (!current) break;

            if (current.x === goalX && current.y === goalY) {
                // reconstruct path
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

                    // skip solid tiles (can't path through solid)
                    try {
                        const tile = cm.getTileValue(nx, ny);
                        if (tile && tile.type === 'solid') continue;
                        // prevent corner cutting: if moving diagonally, ensure both adjacent orthogonals are not solid
                        if (dx !== 0 && dy !== 0) {
                            const t1 = cm.getTileValue(current.x + dx, current.y);
                            const t2 = cm.getTileValue(current.x, current.y + dy);
                            if ((t1 && t1.type === 'solid') || (t2 && t2.type === 'solid')) continue;
                        }
                    } catch (e) { /* be conservative: treat as passable */ }

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
        // no path found
        return null;
    }

    // Choose a random reachable tile within roamRadius and set path to it
    chooseRoamTarget() {
        // Use BFS flood from current tile to find reachable empty tiles within roamRadius.
        const ts = this.scene.noiseTileSize || 16;
        const startX = Math.floor((this.pos.x + this.size.x*0.5) / ts);
        const startY = Math.floor((this.pos.y + this.size.y*0.5) / ts);
        const cm = this.scene.chunkManager;

        const keyOf = (x,y)=>`${x},${y}`;
        const visited = new Set();
        const cameFrom = new Map();
        const q = [];
        visited.add(keyOf(startX,startY));
        q.push({x:startX,y:startY,d:0});

        const candidates = [];
        const maxNodes = Math.max(300, this.roamAttempts * 20);
        let nodes = 0;

        while (q.length && nodes < maxNodes) {
            const cur = q.shift();
            nodes++;
            // skip the start tile as a candidate
            if (!(cur.x === startX && cur.y === startY)) {
                // ensure not solid
                try {
                    const t = cm.getTileValue(cur.x, cur.y);
                    if (!t || t.type !== 'solid') candidates.push({x:cur.x,y:cur.y});
                } catch (e) {
                    candidates.push({x:cur.x,y:cur.y});
                }
            }

            if (cur.d >= this.roamRadius) continue;

            for (let dy=-1; dy<=1; dy++){
                for (let dx=-1; dx<=1; dx++){
                    if (dx===0 && dy===0) continue;
                    const nx = cur.x + dx;
                    const ny = cur.y + dy;
                    const kk = keyOf(nx,ny);
                    if (visited.has(kk)) continue;
                    // skip nodes that are solid
                    try {
                        const t = cm.getTileValue(nx, ny);
                        if (t && t.type === 'solid') continue;
                        // prevent corner cutting on diagonals
                        if (dx !== 0 && dy !== 0) {
                            const t1 = cm.getTileValue(cur.x + dx, cur.y);
                            const t2 = cm.getTileValue(cur.x, cur.y + dy);
                            if ((t1 && t1.type === 'solid') || (t2 && t2.type === 'solid')) continue;
                        }
                    } catch (e) {
                        // if tile checks fail, skip this neighbor to be safe
                        continue;
                    }
                    visited.add(kk);
                    cameFrom.set(kk, keyOf(cur.x,cur.y));
                    q.push({x:nx,y:ny,d:cur.d+1});
                }
            }
        }

        if (candidates.length === 0) {
            this.roamTarget = null;
            return false;
        }

        // pick random candidate that is not too close to player
        const playerCenter = this.scene.player ? this.scene.player.pos.add(this.scene.player.size.mult(0.5)) : null;
        const suitable = candidates.filter(c => {
            if (!playerCenter) return true;
            const px = c.x * ts + ts*0.5;
            const py = c.y * ts + ts*0.5;
            const d = Math.hypot(px - playerCenter.x, py - playerCenter.y);
            return d > ts * 1.2;
        });

        const pool = suitable.length ? suitable : candidates;
        // choose random element
        const pick = pool[Math.floor(Math.random() * pool.length)];

        // reconstruct path from pick back to start using cameFrom
        const path = [];
        let curKey = keyOf(pick.x, pick.y);
        // if pick wasn't in cameFrom (possible since candidates included start adjacent), attempt to build via findPath
        if (!cameFrom.has(curKey)) {
            const direct = this.findPath(startX, startY, pick.x, pick.y, 1200);
            if (direct && direct.length > 0) {
                this.path = direct;
                this.pathIdx = 0;
                this.roamTarget = { x: pick.x, y: pick.y };
                this.pathTimer = this.pathRecalc;
                return true;
            }
            this.roamTarget = null;
            return false;
        }

        // backtrack
        while (curKey && curKey !== keyOf(startX,startY)) {
            const parts = curKey.split(',').map(Number);
            path.unshift({ x: parts[0], y: parts[1] });
            curKey = cameFrom.get(curKey);
        }

        if (path.length === 0) {
            this.roamTarget = null;
            return false;
        }

        this.path = path;
        this.pathIdx = 0;
        this.roamTarget = { x: pick.x, y: pick.y };
        this.pathTimer = this.pathRecalc;
        return true;
    }

    _followPath(delta) {
        if (!this.path || this.path.length === 0) return;
        // find next non-equal node
        while (this.pathIdx < this.path.length) {
            const node = this.path[this.pathIdx];
            const ts = this.scene.noiseTileSize || 16;
            const target = new Vector(node.x * ts + ts*0.5, node.y * ts + ts*0.5);
            const disp = target.sub(this.pos);
            const dist = Math.hypot(disp.x, disp.y);
            if (dist < Math.max(4, ts*0.3)) {
                this.pathIdx++;
                continue;
            }
            const want = disp.div(dist).mult(this.speed);
            // simple smoothing
            this.vlos.x += (want.x - this.vlos.x) * Math.min(1, delta * 6);
            this.vlos.y += (want.y - this.vlos.y) * Math.min(1, delta * 6);
            return;
        }
        // reached end
        this.path = null;
        this.pathIdx = 0;
    }

    update(delta){
        super.update(delta)
        if (!this.scene || !this.scene.player) return;
        const player = this.scene.player;
        const pCenter = player.pos.add(player.size.mult(0.5));
        const meCenter = this.pos.add(this.size.mult(0.5));
        const dist = pCenter.distanceTo(meCenter);

        // timers
        this.pathTimer -= delta;
        this.attackCooldown -= delta;
        if (this.swoopTimer > 0) this.swoopTimer -= delta; else this.isSwooping = false;

        // Attack behavior: swoop if close
        if (dist <= this.attackRange && this.attackCooldown <= 0) {
            // begin swoop
            this.isSwooping = true;
            this.swoopTimer = 0.6;
            this.attackCooldown = this.attackCooldownTime;
            // set quick lunge towards player
            const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
            this.vlos.x = dir.x * this.speed * 1.6;
            this.vlos.y = dir.y * this.speed * 1.4 - Math.abs(this.speed*0.4);
            // after attacking, pick a new roam target so moths desync
            this.chooseRoamTarget();
        }

        if (this.isSwooping) {
            // gentle drag while swooping
            this.vlos.x *= 0.98;
            this.vlos.y *= 0.98;
        } else {
            // normal flight: pathfind towards player
            if (!this.path || this.pathTimer <= 0) {
                const ts = this.scene.noiseTileSize || 16;
                const sx = Math.floor((this.pos.x + this.size.x*0.5) / ts);
                const sy = Math.floor((this.pos.y + this.size.y*0.5) / ts);

                if (this.attackCooldown > 0) {
                    // between attacks: roam to a random reachable tile
                    if (!this.roamTarget) {
                        this.chooseRoamTarget();
                    }
                    if (this.roamTarget) {
                        const rx = this.roamTarget.x;
                        const ry = this.roamTarget.y;
                        const newPath = this.findPath(sx, sy, rx, ry, 1500);
                        if (newPath && newPath.length > 0) {
                            this.path = newPath;
                            this.pathIdx = 0;
                        } else {
                            // couldn't reach roam target; clear for next attempt
                            this.roamTarget = null;
                        }
                    } else {
                        // fallback: small random jitter steering
                        const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
                        this.vlos.x += (dir.x * this.speed - this.vlos.x) * Math.min(1, delta*2);
                        this.vlos.y += (dir.y * this.speed - this.vlos.y) * Math.min(1, delta*2);
                    }
                } else {
                    // not between attacks: actively path toward player
                    const px = Math.floor(pCenter.x / ts);
                    const py = Math.floor(pCenter.y / ts);
                    const newPath = this.findPath(sx, sy, px, py, 2000);
                    if (newPath && newPath.length > 0) {
                        this.path = newPath;
                        this.pathIdx = 0;
                        this.roamTarget = null;
                    } else {
                        // direct steering if no path
                        const dir = pCenter.sub(meCenter).div(Math.max(1, dist));
                        this.vlos.x += (dir.x * this.speed - this.vlos.x) * Math.min(1, delta*4);
                        this.vlos.y += (dir.y * this.speed - this.vlos.y) * Math.min(1, delta*4);
                    }
                }
                this.pathTimer = this.pathRecalc;
            }
            // follow path
            this._followPath(delta);
        }

        // integrate position
        this.pos = this.pos.add(this.vlos.mult(delta));
        if (this.vlos.x < -0.1) this.invert = new Vector(-1, 1);
        else if (this.vlos.x > 0.1) this.invert = new Vector(1, 1);
    }

    draw(levelOffset){
        
        super.draw(levelOffset)

        // Draw red eyes on top of the sprite unaffected by brightness.
        try {
            const drawPos = this.pos.add(levelOffset);
            const animName = (this.sheet && this.sheet.currentAnimation && this.sheet.currentAnimation.name) ? this.sheet.currentAnimation.name : null;
            const frame = (this.sheet && typeof this.sheet.currentFrame === 'number') ? this.sheet.currentFrame : 0;
            const slice = this.sheet && this.sheet.slicePx ? this.sheet.slicePx : 16;

            if (!this.sheet._eyeCache) this.sheet._eyeCache = new Map();
            const cacheKey = `${animName || '__'}:${frame}`;
            let eyePixels = this.sheet._eyeCache.get(cacheKey);
            if (!eyePixels) {
                eyePixels = [];
                try {
                    // Prefer direct frame canvas from spritesheet (materialized if needed)
                    let frameCanvas = null;
                    if (typeof this.sheet.getFrame === 'function' && animName) {
                        frameCanvas = this.sheet.getFrame(animName, frame);
                    }
                    if (!frameCanvas) {
                        // fallback to using packed sheet canvas and slicing out region
                        if (this.sheet && this.sheet.sheet && this.sheet.slicePx) {
                            const off = document.createElement('canvas');
                            off.width = slice; off.height = slice;
                            const ctx = off.getContext('2d');
                            let meta = null;
                            if (animName) {
                                if (this.sheet.animations instanceof Map) meta = this.sheet.animations.get(animName);
                                else if (this.sheet.animations && this.sheet.animations[animName]) meta = this.sheet.animations[animName];
                            }
                            const row = meta && (meta.row !== undefined) ? meta.row : 0;
                            const fi = Math.max(0, Math.floor(Number(frame) || 0));
                            const sx = fi * slice;
                            const sy = row * slice;
                            ctx.clearRect(0,0,slice,slice);
                            ctx.drawImage(this.sheet.sheet, sx, sy, slice, slice, 0, 0, slice, slice);
                            frameCanvas = off;
                        }
                    }

                    if (frameCanvas) {
                        const ctx = frameCanvas.getContext('2d');
                        const sw = frameCanvas.width;
                        const sh = frameCanvas.height;
                        // Scan corrected eye region (inclusive): x 8..12, y 8..12
                        const startX = 8;
                        const startY = 8;
                        const endX = 12;
                        const endY = 12;
                        const sx = Math.max(0, Math.min(sw - 1, startX));
                        const sy = Math.max(0, Math.min(sh - 1, startY));
                        const ex = Math.max(0, Math.min(sw - 1, endX));
                        const ey = Math.max(0, Math.min(sh - 1, endY));
                        const w = ex - sx + 1;
                        const h = ey - sy + 1;
                        if (w > 0 && h > 0) {
                            const data = ctx.getImageData(sx, sy, w, h).data;
                            const TOL = 120; const TOL2 = TOL * TOL;
                            for (let yy = 0; yy < h; yy++) {
                                for (let xx = 0; xx < w; xx++) {
                                    const idx = (yy * w + xx) * 4;
                                    const r = data[idx];
                                    const g = data[idx+1];
                                    const b = data[idx+2];
                                    const dr = r - 251;
                                    const dg = g - 30;
                                    const db = b - 25;
                                    if (dr * dr + dg * dg + db * db <= TOL2) {
                                        eyePixels.push({ x: sx + xx, y: sy + yy });
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    // image not ready or cross-origin; skip
                    eyePixels = [];
                }
                this.sheet._eyeCache.set(cacheKey, eyePixels);
                try { console.log(`[Moth] eyePixels ${cacheKey} = ${eyePixels.length}`); } catch(e) {}
            }

            if (eyePixels && eyePixels.length) {
                const pixelW = this.size.x / slice;
                const pixelH = this.size.y / slice;
                const flipped = (this.invert && this.invert.x && this.invert.x < 0);
                for (const p of eyePixels) {
                    const pxIndex = flipped ? (slice - 1 - p.x) : p.x;
                    const wx = drawPos.x + (pxIndex / slice) * this.size.x;
                    const wy = drawPos.y + (p.y / slice) * this.size.y;
                    this.Draw.rect(new Vector(wx, wy), new Vector(pixelW, pixelH), 'rgba(251,30,25,1)', true);
                }
            }
        } catch (e) {
            // swallow overlay errors
        }
        // choose facing
        // Optional debug: draw computed path and roam target if scene requests it
        try {
            if (this.scene && this.scene.debugMothPaths) {
                const ts = this.scene.noiseTileSize || 16;
                // draw path nodes as connected lines
                if (this.path && this.path.length) {
                    let prev = this.pos.add(this.size.mult(0.5));
                    for (let i = this.pathIdx; i < this.path.length; i++) {
                        const node = this.path[i];
                        const nx = node.x * ts + ts * 0.5;
                        const ny = node.y * ts + ts * 0.5;
                        const next = new Vector(nx, ny);
                        this.Draw.line(prev, next, 'rgba(0,200,0,0.6)', 2);
                        prev = next;
                    }
                }
                // draw roam target
                if (this.roamTarget) {
                    const cx = this.roamTarget.x * ts + ts * 0.5;
                    const cy = this.roamTarget.y * ts + ts * 0.5;
                    this.Draw.circle(new Vector(cx, cy), Math.max(2, ts * 0.2), 'rgba(255,0,0,0.3)', true);
                    this.Draw.circle(new Vector(cx, cy), Math.max(2, ts * 0.2), 'rgba(255,255,255,0.3)', false, 2);
                }
                // draw attack line to player when swooping (debug)
                try {
                    if (this.isSwooping && this.scene && this.scene.player) {
                        const playerCenter = this.scene.player.pos.add(this.scene.player.size.mult(0.5));
                        const meCenter = this.pos.add(this.size.mult(0.5));
                        this.Draw.line(meCenter, playerCenter, 'rgba(255,0,0,0.5)', 2);
                    }
                } catch (e) {}
            }
        } catch (e) { /* ignore drawing failures */ }
    }
}
