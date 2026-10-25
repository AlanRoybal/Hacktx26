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


export function drawTitle(c: CanvasRenderingContext2D, g: Game, kind: 'title' | 'pause' | 'handoff' = 'title') {
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
      if (sel) { c.fillStyle = '#1A0A00'; c.fillRect(x0 - 3, y - 8, 10 * 9 + 4, 16); }
      for (let k = 0; k < 10; k++) { c.fillStyle = k < value ? (sel ? '#FFFFFF' : HOT) : (sel ? '#5A3A24' : '#3A2A1E'); c.fillRect(x0 + k * 9, y - 5, 7, 10); }
      const ar = sel ? '#FFFFFF' : HOT;
      txt(c, '◀', x0 - 10, y, `bold ${size - 4}px ${MONO}`, ar); txt(c, '▶', x0 + 96, y, `bold ${size - 4}px ${MONO}`, ar);
    } else if (value) txt(c, `◀ ${value} ▶`, cx + w / 2 - 14, y, `bold ${size - 4}px ${MONO}`, sel ? '#FFFFFF' : HOT, 0, '', 0, 'right');
  };
  if (kind === 'pause') {
    c.fillStyle = 'rgba(6,3,2,.86)'; c.fillRect(0, 0, UI_W, UI_H);
    txt(c, 'PAUSED', cx, 78, `64px ${IMPACT}`, '#FFFFFF', 4, ORANGE, 4);
    txt(c, `TEX ${g.tex}   ·   OU ${g.ou}`, cx, 140, `30px ${IMPACT}`, ORANGE, 3, CRIMSON, 2);
    const ck = Math.max(0, Math.ceil(g.clock));
    txt(c, `${['', '1ST', '2ND', '3RD', '4TH'][Math.min(4, g.down)]} & ${g.toGo >= g.ballOn ? 'GOAL' : g.toGo}  ·  ${Math.floor(ck / 60)}:${String(ck % 60).padStart(2, '0')} LEFT`, cx, 172, `bold 14px ${MONO}`, CREAM, 3);
    ['CONTINUE', 'END GAME'].forEach((t, i) => item(t, 214 + i * 34, i === g.pauseSel, 230, 26));
    txt(c, 'STICK / ARROWS TO MOVE · ZR / ENTER TO SELECT · HOME / ESC TO RESUME', cx, 300, `bold 11px ${MONO}`, '#FFB066', 0);
    const pads = g.padBatteries();
    if (!pads.length) txt(c, 'NO JOY-CON CONNECTED', cx, 276, `bold 12px ${MONO}`, DIM, 2);
    pads.forEach((p, i) => {   // JOY-CON L [####] per pad, 4 blocks = full
      const w = 150, x = cx - (pads.length * w) / 2 + i * w + 8, y = 276;
      const col = p.level <= 1 ? '#FF4A3A' : p.level === 2 ? '#FFB066' : '#FFFFFF';
      txt(c, `JOY-CON ${p.side}`, x, y, `bold 12px ${MONO}`, CREAM, 2, '', 0, 'left');
      for (let k = 0; k < 4; k++) { c.fillStyle = k < p.level ? col : '#3A2A1E'; c.fillRect(x + 86 + k * 9, y - 5, 7, 10); }
      if (p.charging) txt(c, '+', x + 126, y, `bold 12px ${MONO}`, '#7CFF7C', 0, '', 0, 'left');
    });
    return;
  }
  if (kind === 'handoff') {
    c.fillStyle = 'rgba(6,3,2,.86)'; c.fillRect(0, 0, UI_W, UI_H);
    const LR = (h?: string) => (h === 'L' ? 'LEFT' : 'RIGHT');
    if (g.handoffWhy === 'PICK') {
      const p1 = g.pickN === 1;
      txt(c, 'PICK YOUR CONTROLLER', cx, 54, `bold 14px ${MONO}`, '#FFB066', 4);
      txt(c, `PLAYER ${g.pickN}`, cx, 112, `64px ${IMPACT}`, '#FFFFFF', 4, p1 ? ORANGE : CRIMSON, 4);
      txt(c, p1 ? 'TEXAS QB' : 'OKLAHOMA QB', cx, 168, `30px ${IMPACT}`, p1 ? ORANGE : '#E03A3C', 3, '#000', 2);
      txt(c, 'PULL THE TRIGGER ON THE JOY-CON YOU THROW WITH', cx, 222, `bold 14px ${MONO}`, CREAM, 3);
      if (!p1) txt(c, `PLAYER 1 HAS THE ${LR(g.hands[1])}  ·  SAME ONE IS FINE, YOU PASS IT AT EACH SWAP`, cx, 250, `bold 12px ${MONO}`, CREAM, 1);
      txt(c, 'ZR OR ZL  ·  ENTER FOR MOUSE', cx, 288, `bold 14px ${MONO}`, '#FFB066', 2);
      return;
    }
    const tex = g.offTeam === 'tex';
    txt(c, g.handoffWhy === 'HALFTIME' ? 'TEAMS SWITCH ENDS' : g.handoffWhy, cx, 54, `bold 14px ${MONO}`, '#FFB066', 4);
    txt(c, g.handoffWhy === 'HALFTIME' ? 'HALFTIME' : 'SWITCH QBS', cx, 112, `64px ${IMPACT}`, '#FFFFFF', 4, tex ? ORANGE : CRIMSON, 4);
    txt(c, `PLAYER ${g.qbPlayer}  ·  ${g.offName} QB`, cx, 168, `30px ${IMPACT}`, tex ? ORANGE : '#E03A3C', 3, '#000', 2);
    const ck = Math.max(0, Math.ceil(g.clock));
    txt(c, `TEX ${g.tex}   ·   OU ${g.ou}   ·   ${Math.floor(ck / 60)}:${String(ck % 60).padStart(2, '0')} LEFT`, cx, 210, `bold 16px ${MONO}`, CREAM, 3);
    const h = g.hands[g.qbPlayer];
    txt(c, !h ? 'HAND OVER THE JOY-CONS' : g.sharedPad ? `HAND OVER THE ${LR(h)} JOY-CON` : `PLAYER ${g.qbPlayer}: GRAB THE ${LR(h)} JOY-CON`, cx, 262, `bold 14px ${MONO}`, CREAM, 3);
    txt(c, `${h === 'L' ? 'ZL' : 'ZR'} / ENTER WHEN READY`, cx, 288, `bold 14px ${MONO}`, '#FFB066', 2);
    return;
  }
  if (m.page === 'home') {
    txt(c, 'RED RIVER', cx, 92, `86px ${IMPACT}`, ORANGE, 4, CRIMSON, 5);
    txt(c, 'TEXAS VS OKLAHOMA · COTTON BOWL · DALLAS', cx, 148, `bold 14px ${MONO}`, '#FDF9D8', 4);
    ['START', '1V1', 'SETTINGS', 'QUIT'].forEach((t, i) => item(t, 172 + i * 26, i === m.sel, 230, 22));
    txt(c, 'STICK / ARROWS TO MOVE · ZR / CLICK / ENTER TO SELECT', cx, 268, `bold 13px ${MONO}`, '#FFB066', 1);
    const rows = g.board().slice(0, 5);
    if (rows.length) {
      txt(c, 'LEADERBOARD', cx, 286, `bold 12px ${MONO}`, HOT, 4);
      rows.forEach((r, i) => txt(c, `${i + 1}  ${r.n.padEnd(3)}  ${r.r.toFixed(1).padStart(5)}  ${String(r.yds).padStart(3)} YDS${r.win ? ' · W' : '    '}`,
        cx, 301 + i * 13, `bold 12px ${MONO}`, CREAM, 0));
    }
  } else {
    txt(c, 'SETTINGS', cx, 62, `60px ${IMPACT}`, '#FFFFFF', 4, ORANGE, 4);
    const val = (r: string) => ({ DIFFICULTY: st.difficulty.toUpperCase(), QUALITY: st.quality.toUpperCase(), MUSIC: st.music, ANNOUNCERS: st.voice, CROWD: st.crowd,
      'THROWING HAND': st.hand === 'auto' ? 'AUTO' : st.hand === 'R' ? 'RIGHT' : 'LEFT' } as Record<string, string | number>)[r] ?? '';
    (g.constructor as any).SETTINGS_ROWS.forEach((r: string, i: number) => item(r, 112 + i * 26, i === m.sel, 400, 19, val(r)));
    txt(c, 'UP / DOWN TO PICK · LEFT / RIGHT TO CHANGE · ZR TO SELECT', cx, 326, `bold 13px ${MONO}`, '#FFB066', 1);
  }
}

