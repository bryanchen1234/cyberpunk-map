import type { Fix } from '../map/map';

/** Speedometer + readouts, with the cut-corner chrome. */
export class Hud {
  readonly el = document.createElement('div');
  private speedNum: HTMLElement;
  private rows: Record<'heading' | 'accuracy' | 'coords', HTMLElement>;

  constructor() {
    this.el.className = 'hud-top';
    this.el.innerHTML = `
      <div class="panel speed">
        <div class="num" data-speed>--</div>
        <div class="unit">mph</div>
      </div>
      <div class="panel readout">
        <span class="label">Heading</span><span class="num" data-heading>--</span>
        <span class="label">Accuracy</span><span class="num" data-accuracy>--</span>
        <span class="label">Position</span><span class="num" data-coords>--</span>
      </div>`;

    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector(sel) as T;
    this.speedNum = q('[data-speed]');
    this.rows = {
      heading: q('[data-heading]'),
      accuracy: q('[data-accuracy]'),
      coords: q('[data-coords]'),
    };
  }

  update(fix: Fix) {
    // coords.speed comes in m/s and is null when the GPS doesn't know it.
    this.speedNum.textContent =
      fix.speed === null || Number.isNaN(fix.speed)
        ? '--'
        : Math.max(0, Math.round(fix.speed * 2.23694)).toString();

    this.rows.heading.textContent =
      fix.heading === null || Number.isNaN(fix.heading)
        ? '--'
        : `${Math.round(fix.heading)}° ${cardinal(fix.heading)}`;

    this.rows.accuracy.textContent = `±${fix.accuracy.toFixed(0)} m`;
    this.rows.coords.textContent = `${fix.lat.toFixed(5)}, ${fix.lng.toFixed(5)}`;
  }
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const cardinal = (deg: number) => POINTS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]!;
