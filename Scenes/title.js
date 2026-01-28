import Scene from './Scene.js';
import { v } from '../js/modules/Vector.js';
import UIButton from '../js/UI/jsElements/Button.js';

export class TitleScene extends Scene {
    constructor(...args) {
        super('title', ...args);
        this.started = false;
        this.bgImage = null;
        this.bgLoaded = false;
        this.startButton = null;
    }

    async onPreload(resources = null) {
        try {
            // Ensure the custom element is registered before we try to use it.
            await import('../js/UI/jsElements/LoadingOverlay.js');
        } catch (e) {
            console.warn('TitleScene: failed to preload LoadingOverlay', e);
        }

        // Preload background image (simple assignment; loading happens asynchronously)
        try {
            this.bgImage = new Image();
            this.bgImage.onload = () => { this.bgLoaded = true; };
            this.bgImage.src = 'Assets/backgrounds/titleBg.png';
        } catch (e) {
            console.warn('TitleScene: failed to start loading background image', e);
        }

        this.isPreloaded = true;
        return true;
    }

    onReady() {
        if (this.isReady) return;
        this.isReady = true;

        // Create and attach the loading overlay DOM element (initially hidden).
        try {
            if (!customElements.get('loading-overlay')) {
                // Fallback: import again if not yet defined
                // (safe no-op if already evaluated once).
                // eslint-disable-next-line no-void
                void import('../js/UI/jsElements/LoadingOverlay.js');
            }
        } catch (e) {
            console.warn('TitleScene: customElements check failed', e);
        }

        this.overlay = document.createElement('loading-overlay');
        document.body.appendChild(this.overlay);

        if (typeof this.overlay.hide === 'function') this.overlay.hide();
        if (typeof this.overlay.setTitle === 'function') this.overlay.setTitle('Dwarves Are Stealing My Bread');
        if (typeof this.overlay.setMessage === 'function') this.overlay.setMessage('Preparing world...');
        if (typeof this.overlay.setProgress === 'function') this.overlay.setProgress(0);

        // Expose globally so game/other scenes can interact if needed.
        try { window.__loadingOverlay = this.overlay; } catch (e) {}

        // Create a simple start button (placement can be adjusted later).
        const btnPos = v(912, 352);
        const btnSize = v(547, 242);
        this.startButton = new UIButton(this.mouse, this.keys, btnPos, btnSize, 'UI', null, '#33333300', '#55500077', '#11111177');
        this.startButton.onPressed.left.connect(() => {
            if (this.started) return;
            this.started = true;

            if (typeof this.overlay.show === 'function') this.overlay.show();
            if (typeof this.overlay.setMessage === 'function') this.overlay.setMessage('Loading world...');
            if (typeof this.overlay.setProgress === 'function') this.overlay.setProgress(0);

            this.preloadScene('main', { overlay: this.overlay })
                .then(() => {
                    if (typeof this.overlay.setMessage === 'function') {
                        this.overlay.setMessage('World ready. Entering game...');
                    }
                    this.switchScene('main');
                })
                .catch((e) => {
                    console.error('TitleScene: failed to preload main scene', e);
                    if (typeof this.overlay.setMessage === 'function') {
                        this.overlay.setMessage('Failed to load game. Check console for details.');
                    }
                });
        });
    }

    sceneTick(tickDelta) {
        if (!this.isReady) return;

        // Basic input update
        this.mouse.setMask(0);
        this.mouse.update(tickDelta);
        this.keys.update(tickDelta);

        if (this.startButton) {
            this.startButton.update(tickDelta);
        }
    }

    draw() {
        if (!this.isReady) return;

        // Draw background on the bg layer
        this.Draw.useCtx('bg');
        this.Draw.image(this.bgImage, v(0, 0), v(1920, 1080));

        // Draw UI button on UI layer
        this.UIDraw.clear();
        if (this.startButton) {
            this.startButton.draw(this.UIDraw);
        }
    }
}

export default TitleScene;
