import Component from './Component.js';
import { mergeObjects, pickDefaults } from '../utils/Support.js';

/**
 * ScrollComponent
 * Holds scroll metadata (lore text, recipe reference, svg image) and can
 * apply per-instance metadata overrides from chunk/entity placement JSON.
 *
 * This component is configured from JSON in two places:
 * - Prefab defaults: data/entities.json -> scroll.components.ScrollComponent.opts
 * - Per-instance overrides: data/chunks.json -> entity.data.components.scroll
 *
 * Per-instance example (lore-only):
 * {
 *   "pos": [8, 12],
 *   "type": "scroll",
 *   "data": {
 *     "size": [16, 16],
 *     "components": {
 *       "scroll": {
 *         "title": "Test Lore Scroll",
 *         "icon": "lore",
 *         "lore": "Some lore...\nSecond line.",
 *         "recipe": null,
 *         "svg": ""
 *       }
 *     }
 *   }
 * }
 */

/**
 * Icons supported by the scroll spritesheet.
 * These map to animation names in data/textures.json -> scroll.animations.
 *
 * @typedef {'idle'|'recipe'|'target'|'lore'|'help'|'direction'|'blank'} ScrollIcon
 */

/**
 * Recipe payload variants a scroll may reference.
 *
 * Lore scrolls generally use: recipe: null
 *
 * Crafting recipe reference (looks up recipes.json -> crafting[size] by output id):
 * { kind: 'crafting', size: '3x3', output: 'anvil', amount?: 1 }
 *
 * Furnace recipe reference (looks up recipes.json -> smelting by output id):
 * { kind: 'smelting', output: 'glass' }
 *
 * Display-only/freeform string:
 * 'Mix flour + water'
 *
 * @typedef {(
 *   | { kind: 'crafting'|'craft', size: '1x1'|'2x2'|'3x3', output: string, amount?: number }
 *   | { kind: 'smelting'|'furnace', output: string }
 *   | string
 *   | null
 * )} ScrollRecipe
 */

/**
 * Scroll metadata JSON stored under: entity.data.components.scroll
 *
 * @typedef {Object} ScrollMeta
 * @property {string} [title] Display title used in the popup.
 * @property {string} [lore] Lore body text. Newlines ("\n") are supported.
 * @property {ScrollRecipe} [recipe] Optional recipe reference or display-only string.
 * @property {string} [svg] Optional SVG image path/URL (e.g. 'Assets/ui/scrolls/foo.svg').
 * @property {ScrollIcon} [icon] Optional sprite icon/animation name.
 * @property {boolean} [isSign] When true, treat this as a sign (sign UI/texture).
 */
export default class ScrollComponent extends Component {
    constructor(entity, data, opts = {}) {
        const Dependencies = {
            manager: null,
        };

        const defaults = {
            title: 'Scroll',
            lore: '',
            recipe: null,
            svg: '',
            icon: 'lore', // maps to spritesheet animation name for scroll.png
            // When true, this instance represents a sign; UI will render
            // a simplified sign-style popup instead of the full scroll UI.
            isSign: false,
        };

        super(entity, Dependencies, data);
        Object.assign(this, mergeObjects(opts, defaults));
    }

    init() {
        this._applyIcon();
    }

    _applyIcon() {
        try {
            const sheet = this.entity.getComponent('sheet');
            if (!sheet || !sheet.sheet || !this.icon) return;
            sheet.sheet.playAnimation(this.icon, false);
        } catch (e) {
            // ignore
        }
    }

    /**
     * Apply per-instance metadata (usually from chunk placement JSON).
     * Supported keys: title, lore, recipe, svg, icon
     * @param {ScrollMeta} meta
     */
    applyMeta(meta = {}) {
        if (!meta || typeof meta !== 'object') return;
        if (meta.title !== undefined) this.title = String(meta.title);
        if (meta.lore !== undefined) this.lore = String(meta.lore);
        if (meta.recipe !== undefined) this.recipe = meta.recipe;
        if (meta.svg !== undefined) this.svg = String(meta.svg);
        if (meta.icon !== undefined) this.icon = String(meta.icon);
        if (meta.isSign !== undefined) this.isSign = !!meta.isSign;
        this._applyIcon();
    }

    getData() {
        return {
            title: this.title,
            lore: this.lore,
            recipe: this.recipe,
            svg: this.svg,
            icon: this.icon,
            isSign: !!this.isSign,
        };
    }

    clone(entity) {
        const defaults = {
            title: 'Scroll',
            lore: '',
            recipe: null,
            svg: '',
            icon: 'lore',
            isSign: false,
        };
        const data = pickDefaults(this.Dependencies, this);
        const opts = pickDefaults(defaults, this);
        const cloned = new ScrollComponent(entity, data, opts);
        return cloned;
    }
}
