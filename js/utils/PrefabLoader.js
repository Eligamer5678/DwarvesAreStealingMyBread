import Entity from '../entities/Entity.js';
import Vector from '../modules/Vector.js';
import { mergeObjects } from './Support.js';

export default class PrefabLoader {
    // Convert keys like 'sheetComponent' -> 'SheetComponent'
    static toPascal(name){
        return name.replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, _p, c)=>c.toUpperCase());
    }

    /**
     * Load JSON file (browser/runtime fetch)
     * @param {string} path
     */
    static async loadJSON(path){
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error('Failed to load '+path);
            return await res.json();
        } catch (e) {
            console.warn('PrefabLoader.loadJSON failed', e);
            return null;
        }
    }

    /**
     * Load and register entity prefabs from a JSON file.
     * @param {string} jsonPath - relative URL to entities.json
     * @param {object} sceneData - { chunkManager, target }
     * @param {Map} spriteImages - map of sprite keys -> SpriteSheet
     */
    static async loadAndRegister(jsonPath, entityManager, sceneData, spriteImages){
        const data = await PrefabLoader.loadJSON(jsonPath);
        if (!data) return false;
        for (const [key, def] of Object.entries(data)){
            // create minimal entity; position/size will be set at spawn time
            const ent = new Entity(new Vector(0, -16), new Vector(16,16));
            const comps = def.components;
            for (const [compKey, compData] of Object.entries(comps)){
                // Get the module & create an instance
                const moduleName = compKey;
                let mod = null;
                try { mod = await import(`../components/${moduleName}.js`); } catch (e) { console.warn('PrefabLoader: failed to import', moduleName, e); continue; }
                const createdComponent = mod.default;
                // sheet component needs spritesheet
                const name = compData.name;
                if (moduleName === 'SheetComponent'){
                    const sheetKey = compData.sheet;
                    const baseSheet = spriteImages.get(sheetKey);
                    // Do not mutate the shared `sceneData` object — create a
                    // per-component dependency object so each SheetComponent
                    // receives the correct `baseSheet` for its sprite key.
                    const deps = Object.assign({}, sceneData, { baseSheet: baseSheet });
                    const instance = new createdComponent(ent, deps, compData.opts);
                    // Ensure prototype component knows its manager so clones
                    // can inherit the reference (via pickDefaults during clone).
                    instance.manager = entityManager;
                    ent.setComponent(name, instance);
                }else{
                    const instance = new createdComponent(ent, sceneData, compData.opts);
                    instance.manager = entityManager;
                    ent.setComponent(name, instance);
                }
                continue;
            }

            // Apply extra properties from the prefab (e.g. health, team)
            const extra = def.extra || {};
            if (extra.health !== undefined) ent.health = extra.health;
            if (extra.team !== undefined) ent.team = extra.team;

            entityManager.addEntityType(key, ent);
        }
        return true;
    }
}
