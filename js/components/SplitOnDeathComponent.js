import Vector from "../modules/Vector.js";
import Component from "./Component.js";
import { mergeObjects, pickDefaults } from "../utils/Support.js";

/**
 * SplitOnDeathComponent
 * Spawns smaller entities when the host dies.
 */
export default class SplitOnDeathComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            chunkManager: null,
        };

        const defaults = {
            minSize: 16,
            childType: "slime",
            childCount: 2,
            sizeScale: 0.5,
            inheritHealth: true,
            healthScale: 0.5,
            spread: 0.35,
            powerSplit: true,
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));

        this._didSplit = false;
        this._deathHooked = false;
    }

    clone(entity) {
        const defaults = {
            minSize: 16,
            childType: "slime",
            childCount: 2,
            sizeScale: 0.5,
            inheritHealth: true,
            healthScale: 0.5,
            spread: 0.35,
            powerSplit: true,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new SplitOnDeathComponent(entity, data, opts);
        return cloned;
    }

    defeat() {
        if (this._didSplit) return;
        this._didSplit = true;

        const ent = this.entity;
        const manager = this.manager;
        if (!ent || !manager || typeof manager.addEntity !== "function") {
            try { ent.dead = true; } catch (e) {}
            return;
        }

        const minSize = Math.max(1, Number(this.minSize) || 16);
        const sizeX = Number(ent.size?.x || 0);
        const sizeY = Number(ent.size?.y || 0);
        const baseSize = Math.max(sizeX, sizeY);
        if (baseSize < minSize) {
            // Too small to split: just play defeat animation, then remove.
            this._playDefeatOrRemove(ent);
            return;
        }

        let count = Math.max(1, Number(this.childCount) || 2);
        let childSize = null;
        const spread = Math.max(0, Number(this.spread) || 0);
        const basePos = ent.pos?.clone ? ent.pos.clone() : new Vector(ent.pos?.x || 0, ent.pos?.y || 0);

        // Power-of-two split: 16 = no split, 32 -> 2x16, 64 -> 4x32, 128 -> 8x64, etc.
        if (this.powerSplit && this._isPowerOfTwo(baseSize)) {
            if (baseSize <= 16) {
                this._playDefeatOrRemove(ent);
                return;
            }
            count = Math.max(1, Math.floor(baseSize / 16));
            const nextSize = Math.max(1, Math.floor(baseSize / 2));
            childSize = new Vector(Math.max(1, sizeX * (nextSize / baseSize)), Math.max(1, sizeY * (nextSize / baseSize)));
        } else {
            const scale = Math.max(0.1, Number(this.sizeScale) || 0.5);
            childSize = new Vector(Math.max(1, sizeX * scale), Math.max(1, sizeY * scale));
        }

        let baseHealth = Number(ent.maxHealth ?? ent.health ?? 1) || 1;
        let childHealth = baseHealth;
        if (this.inheritHealth) {
            childHealth = Math.max(1, Math.ceil(baseHealth * (Number(this.healthScale) || 0.5)));
        }

        for (let i = 0; i < count; i++) {
            let offset = new Vector(0, 0);
            if (count <= 2) {
                const dir = (i % 2 === 0) ? -1 : 1;
                offset = new Vector((childSize.x * spread) * dir, 0);
            } else {
                const a = (Math.PI * 2 * i) / count;
                const r = childSize.x * spread;
                offset = new Vector(Math.cos(a) * r, Math.sin(a) * r);
            }
            const pos = basePos.add(offset);
            try {
                manager.addEntity(this.childType, pos, childSize, { health: childHealth });
            } catch (e) {}
        }

        this._playDefeatOrRemove(ent);
    }

    _playDefeatOrRemove(ent) {
        // Play defeat animation if available; otherwise remove immediately.
        try {
            const sheetComp = ent.getComponent?.("sheet");
            const sheet = sheetComp?.sheet;
            if (sheet?.playAnimation) {
                sheet.playAnimation("defeat", true);
                if (!this._deathHooked && sheet.onStop?.connect) {
                    this._deathHooked = true;
                    sheet.onStop.connect(() => {
                        try { ent.dead = true; } catch (e) {}
                    });
                }
                return;
            }
        } catch (e) {}

        try { ent.dead = true; } catch (e) {}
    }

    _isPowerOfTwo(n) {
        const v = Math.floor(Number(n) || 0);
        return v > 0 && (v & (v - 1)) === 0;
    }
}
