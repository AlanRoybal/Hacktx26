import type { Game, Hooks } from '../game/game';
import { PLAYS, OFF_SPOT, type OffPos } from '../game/plays';

const $ = (id: string) => document.getElementById(id)!;
const ORD = ['', '1ST', '2ND', '3RD', '4TH'];
let bannerTimer = 0, statTimer = 0;

function routeSvg(i: number) {
  const p = PLAYS[i];
  const X = (x: number) => 100 - x * 3.3, Y = (y: number) => 62 - y * 1.6;
  let s = `<svg viewBox="0 0 200 70"><line x1="0" y1="62" x2="200" y2="62" stroke="#555" stroke-dasharray="3 3"/>`;
  for (const [pos, pts] of Object.entries(p.routes)) {
    const [sx, sy] = OFF_SPOT[pos as OffPos];
    const d = pts!.map(([x, y], k) => `${k ? 'L' : 'M'}${X(sx + x).toFixed(1)},${Y(Math.max(0, sy + y)).toFixed(1)}`).join(' ');
    s += `<path d="${d}" fill="none" stroke="#FF8A2A" stroke-width="2"/><circle cx="${X(sx)}" cy="${Y(0)}" r="2.5" fill="#fff"/>`;
  }
  return s + '</svg>';
}

export function makeHud(buzz: (ms: number, amp?: number) => void): Hooks {
  $('plays').innerHTML = PLAYS.map((p, i) => `<div class="card" id="card${i}"><h3>${p.name}<span class="k">${i + 1}</span></h3><p>${p.desc}</p>${routeSvg(i)}</div>`).join('');
  return {
    banner(text, sub = '', color = '#BF5700') {
      $('bMain').textContent = text; $('bSub').textContent = sub;
      $('banner').style.setProperty('--c', color);
      $('banner').classList.add('on');
      clearTimeout(bannerTimer);
      bannerTimer = window.setTimeout(() => $('banner').classList.remove('on'), 2200);
    },
    hud(g: Game) {
      $('sTex').textContent = String(g.tex); $('sOu').textContent = String(g.ou);
      const live = ['SNAP', 'POCKET', 'AIR', 'RUN', 'SACK'].includes(g.state);
      const c = Math.max(0, Math.ceil(g.clock - (live ? g.playT : 0)));
      $('sClock').textContent = `${Math.floor(c / 60)}:${String(c % 60).padStart(2, '0')}`;
      $('sDown').textContent = `${ORD[Math.min(4, g.down)]} & ${g.toGo >= g.ballOn ? 'GOAL' : g.toGo}`;
      $('sSpot').textContent = g.ballOn > 50 ? `TEX ${100 - g.ballOn}` : `OU ${g.ballOn}`;
    },
    buzz,
    statCard(lines) {
      $('stat').innerHTML = lines.join('<br>');
      $('stat').classList.add('on');
      clearTimeout(statTimer);
      statTimer = window.setTimeout(() => $('stat').classList.remove('on'), 3000);
    },
    screen(kind, g) {
      const el = $('screen');
      $('scorebug').style.display = kind === 'title' ? 'none' : 'flex';
      if (kind === 'none') { el.classList.remove('on'); return; }
      if (kind === 'title') el.innerHTML = `<h1>RED RIVER</h1><h2>TEXAS VS OKLAHOMA · COTTON BOWL · DALLAS</h2>
        <p>HOLD ZR (OR CLICK) TO TAKE THE FIELD</p>`;
      else {
        const s = g.stats;
        el.innerHTML = `<div class="big">${g.win ? 'TEXAS WINS' : 'OU HOLDS ON'}</div><h2>${g.win ? `${g.tex} - ${g.ou}` : g.overReason}</h2>
          <table><tr><td>COMP / ATT</td><td>${s.comp} / ${s.att}</td></tr><tr><td>PASS YDS</td><td>${s.yds}</td></tr>
          <tr><td>TD / INT</td><td>${s.td} / ${s.int}</td></tr><tr><td>SACKS</td><td>${s.sacks}</td></tr><tr><td>QB RATING</td><td>${g.rating()}</td></tr></table>
          <p>HOLD ZR (OR CLICK) TO PLAY AGAIN</p>`;
      }
      el.classList.add('on');
    },
    plays(sel, show) {
      $('plays').classList.toggle('on', show);
      PLAYS.forEach((_, i) => $(`card${i}`).classList.toggle('sel', i === sel));
    },
  };
}

export function setHint(t: string) { $('hint').textContent = t; }
export function setPill(ok: boolean, label: string) { $('pill').classList.toggle('ok', ok); ($('pill').lastElementChild as HTMLElement).textContent = label; }
export function setDebug(t: string | null) { const d = $('debug'); d.style.display = t === null ? 'none' : 'block'; if (t) d.textContent = t; }
export function setCross(x: number, y: number, on: boolean) { const c = $('cross'); c.style.display = on ? 'block' : 'none'; c.style.left = x + 'px'; c.style.top = y + 'px'; }
export function loaded() { $('loading').style.display = 'none'; }
export function loadingText(t: string) { $('loading').textContent = `LOADING ${t.toUpperCase()}`; }
