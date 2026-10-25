import type { Game } from '../game/game';

/** Home/settings drawn to a low-res canvas that the post pass pixelates, dithers and distresses like the 3D scene. */
export const UI_W = 640, UI_H = 360;
const ORANGE = '#BF5700', CRIMSON = '#841617', CREAM = '#F2E6D6', DIM = '#8A7A68', HOT = '#FF8A2A';
const IMPACT = 'Impact, "Arial Black", sans-serif', MONO = '"Courier New", monospace';

function txt(c: CanvasRenderingContext2D, s: string, x: number, y: number, font: string, color: string, spacing = 0, shadow = '', off = 0, align: CanvasTextAlign = 'center') {
  c.font = font; c.letterSpacing = `${spacing}px`; c.textAlign = align; c.textBaseline = 'middle';
  if (shadow) { c.fillStyle = shadow; c.fillText(s, x + off, y + off); }
  c.fillStyle = color; c.fillText(s, x, y);
}


export function drawTitle(c: CanvasRenderingContext2D, g: Game) {
  c.clearRect(0, 0, UI_W, UI_H);
  const m = g.menu, st = g.settings, cx = UI_W / 2;
  const item = (label: string, y: number, sel: boolean, w: number, size: number, value: string | number = '') => {
    if (sel) {
      c.fillStyle = '#5E2400'; c.fillRect(cx - w / 2, y - size * 0.62, w, size * 1.24);
      c.fillStyle = HOT; c.fillRect(cx - w / 2, y - size * 0.62, 5, size * 1.24);
    }
    const col = sel ? '#FFFFFF' : DIM;
    if (w < 300) return txt(c, label, cx, y, `${size}px ${IMPACT}`, col, 3, sel ? '#1A0A00' : '', 2);
    txt(c, label, cx - w / 2 + 16, y, `${size}px ${IMPACT}`, col, 2, sel ? '#1A0A00' : '', 2, 'left');
    if (typeof value === 'number') {   // volume: 10 chunky blocks
      const x0 = cx + w / 2 - 30 - 10 * 9;
      for (let k = 0; k < 10; k++) { c.fillStyle = k < value ? HOT : '#3A2A1E'; c.fillRect(x0 + k * 9, y - 5, 7, 10); }
      txt(c, '◀', x0 - 10, y, `bold ${size - 4}px ${MONO}`, HOT); txt(c, '▶', x0 + 96, y, `bold ${size - 4}px ${MONO}`, HOT);
    } else if (value) txt(c, `◀ ${value} ▶`, cx + w / 2 - 14, y, `bold ${size - 4}px ${MONO}`, HOT, 0, '', 0, 'right');
  };
  if (m.page === 'home') {
    txt(c, 'RED RIVER', cx, 92, `86px ${IMPACT}`, ORANGE, 4, CRIMSON, 5);
    txt(c, 'TEXAS VS OKLAHOMA · COTTON BOWL · DALLAS', cx, 148, `bold 14px ${MONO}`, '#FDF9D8', 4);
    ['START', 'SETTINGS'].forEach((t, i) => item(t, 186 + i * 34, i === m.sel, 230, 26));
    txt(c, 'STICK / ARROWS TO MOVE · ZR / CLICK / ENTER TO SELECT', cx, 252, `bold 11px ${MONO}`, '#FFB066', 1);
    const rows = g.board().slice(0, 5);
    if (rows.length) {
      txt(c, 'LEADERBOARD', cx, 276, `bold 12px ${MONO}`, HOT, 4);
      rows.forEach((r, i) => txt(c, `${i + 1}  ${r.n.padEnd(3)}  ${r.r.toFixed(1).padStart(5)}  ${String(r.yds).padStart(3)} YDS${r.win ? ' · W' : '    '}`,
        cx, 294 + i * 14, `bold 12px ${MONO}`, CREAM, 0));
    }
  } else {
    txt(c, 'SETTINGS', cx, 62, `60px ${IMPACT}`, '#FFFFFF', 4, ORANGE, 4);
    const val = (r: string) => ({ QUALITY: st.quality.toUpperCase(), MUSIC: st.music, ANNOUNCERS: st.voice, CROWD: st.crowd,
      'THROWING HAND': st.hand === 'auto' ? 'AUTO' : st.hand === 'R' ? 'RIGHT' : 'LEFT' } as Record<string, string | number>)[r] ?? '';
    (g.constructor as any).SETTINGS_ROWS.forEach((r: string, i: number) => item(r, 120 + i * 28, i === m.sel, 400, 19, val(r)));
    txt(c, 'UP / DOWN TO PICK · LEFT / RIGHT TO CHANGE · ZR TO SELECT', cx, 326, `bold 11px ${MONO}`, '#FFB066', 1);
  }
}
