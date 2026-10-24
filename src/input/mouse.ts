import type { InputListener } from './types';

/** Mouse fallback: hold left button (= trigger), flick up toward the target, release.
 * Cursor x/y at release aims; flick speed = arm speed. Space works as the trigger too. */
export class MouseInput {
  private pts: { x: number; y: number; t: number }[] = [];
  down = false;
  aimX = 0; aimY = 0;
  constructor(el: HTMLElement, private l: InputListener, private enabled: () => boolean) {
    el.addEventListener('pointerdown', e => { if (e.button === 0 && this.enabled()) this.press(); });
    window.addEventListener('pointerup', e => { if (e.button === 0 && this.down) this.release(); });
    window.addEventListener('pointermove', e => {
      this.aimX = e.clientX / innerWidth * 2 - 1; this.aimY = 1 - e.clientY / innerHeight * 2;
      if (this.down) { this.pts.push({ x: e.clientX, y: e.clientY, t: performance.now() }); if (this.pts.length > 64) this.pts.shift(); }
    });
  }
  press() { this.down = true; this.pts = []; this.l.onTrigger(true); }
  release() {
    this.down = false;
    this.l.onTrigger(false);
    const now = performance.now();
    const rec = this.pts.filter(p => now - p.t < 120);
    let v = 0, tPeak = now, vPeak = 0;
    if (rec.length > 1) {
      const a = rec[0], b = rec[rec.length - 1];
      v = Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, b.t - a.t) * 1000 / innerHeight;
    }
    const all = this.pts.filter(p => now - p.t < 400);
    for (let i = 1; i < all.length; i++) {
      const sp = Math.hypot(all[i].x - all[i - 1].x, all[i].y - all[i - 1].y) / Math.max(1, all[i].t - all[i - 1].t);
      if (sp > vPeak) { vPeak = sp; tPeak = all[i].t; }
    }
    const timing = vPeak > 0 ? now - tPeak : 0;
    if (v < 0.6) v = 2.2;   // plain click still throws a medium ball
    const speed = 11 + 15 * Math.min(1, (v - 0.6) / 4);
    this.l.onThrow({ speed, launchDeg: 10 + 22 * Math.max(0, this.aimY), yawDeg: -this.aimX * 40, wobble: 0.05,
      timingMs: timing, wPeak: 300 + 300 * v, source: 'mouse' });
  }
}
