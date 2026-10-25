import type { Game, Hooks, BoardRow } from '../game/game';
import { PLAYS, OFF_SPOT, type OffPos } from '../game/plays';
import { drawTitle } from './titleCanvas';

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

function boardHtml(rows: BoardRow[], me: number, n = 5) {
  if (!rows.length) return '';
  return `<table class="board"><tr><th colspan="4">LEADERBOARD</th></tr>` + rows.slice(0, n).map((r, i) =>
    `<tr class="${i === me ? 'me' : ''}"><td>${i + 1}</td><td>${r.n}</td><td>${r.r.toFixed(1)}</td><td>${r.yds} YDS${r.win ? ' · W' : ''}</td></tr>`).join('') + '</table>';
}

function clipHtml(g: Game) {
  const c = g.clip;
  if (!c) return '';
  if (c.status === 'ready') return `<div class="qr"><img src="${c.qr}"><h2>SCAN TO SAVE YOUR PLAY</h2></div>`;
  return `<div class="qr"><div class="qrwait">${c.status === 'saving' ? 'SAVING YOUR PLAY…' : 'CLIP SAVED ON THIS MAC'}</div></div>`;
}

export function makeHud(buzz: (ms: number, amp?: number) => void, rumble: Hooks['rumble']): Hooks {
  $('plays').innerHTML = PLAYS.map((p, i) => `<div class="card" id="card${i}"><h3>${p.name}<span class="k">${i < 4 ? i + 1 : ''}</span></h3><p>${p.desc}</p>${routeSvg(i)}</div>`).join('');
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
      { const [own, opp] = g.offTeam === 'tex' ? ['TEX', 'OU'] : ['OU', 'TEX']; $('sSpot').textContent = g.ballOn > 50 ? `${own} ${100 - g.ballOn}` : `${opp} ${g.ballOn}`; }
      $('sTO').textContent = '●'.repeat(g.timeouts) + '○'.repeat(3 - g.timeouts);
    },
    buzz,
    rumble,
    statCard(lines) {
      $('stat').innerHTML = lines.join('<br>');
      $('stat').classList.add('on');
      clearTimeout(statTimer);
      statTimer = window.setTimeout(() => $('stat').classList.remove('on'), 3000);
    },
    screen(kind, g) {
      const el = $('screen');
      $('scorebug').style.display = kind === 'title' ? 'none' : 'flex';
      g.w.showUI(false);
      document.body.classList.toggle('paused', kind === 'pause' || kind === 'handoff');
      document.body.classList.toggle('potg', g.state === 'POTG');
      let pg = document.getElementById('potg');
      if (!pg) { pg = document.createElement('div'); pg.id = 'potg'; document.body.appendChild(pg); }
      if (g.state === 'POTG' && g.best) pg.innerHTML = `<b>PLAY OF THE GAME</b><span>${g.best.team}  ·  ${g.best.label}</span>`;
      if (kind === 'none') { el.classList.remove('on'); return; }
      if (kind === 'title' || kind === 'pause' || kind === 'handoff') { el.classList.remove('on'); drawTitle(g.w.uiCtx, g, kind); g.w.showUI(true); return; }
      {
        const s = g.stats;
        const card = `<table><tr><td>COMP / ATT</td><td>${s.comp} / ${s.att}</td></tr><tr><td>PASS YDS</td><td>${s.yds}</td></tr>
          <tr><td>TD / INT</td><td>${s.td} / ${s.int}</td></tr><tr><td>SACKS</td><td>${s.sacks}</td></tr><tr><td>LONGEST</td><td>${s.long} YDS</td></tr>
          <tr><td>FASTEST THROW</td><td>${s.fast} MPH</td></tr><tr><td>BEST SPIRAL</td><td>${g.bestSpiralGrade()}</td></tr><tr><td>QB RATING</td><td>${g.rating()}</td></tr></table>`;
        const e = g.entry;
        const right = e
          ? `<div class="enter"><h2>ENTER INITIALS</h2><div class="ini">${e.letters.map((l, i) => `<span class="${i === e.idx ? 'sel' : ''}">${String.fromCharCode(65 + l)}</span>`).join('')}</div>
             <p class="still">STICK UP / DOWN · ZR TO LOCK IN (OR TYPE)</p></div>`
          : boardHtml(g.board(), g.savedRank, 10);
        el.innerHTML = `<div class="big">${g.mode === '1v1' ? (g.tex === g.ou ? 'TIE GAME' : g.tex > g.ou ? 'TEXAS WINS' : 'OKLAHOMA WINS') : g.win ? 'TEXAS WINS' : 'OU HOLDS ON'}</div><h2>${g.mode === '1v1' ? `TEX ${g.tex} - OU ${g.ou}` : g.win ? `${g.tex} - ${g.ou}` : g.overReason}</h2>
          <div class="row">${card}${right}${clipHtml(g)}</div>${e ? '' : '<p>HOLD ZR (OR CLICK) TO PLAY AGAIN</p>'}`;
      }
      el.classList.add('on');
    },
    plays(sel, show) {
      $('plays').classList.toggle('on', show);
      const N = PLAYS.length;
      PLAYS.forEach((_, i) => {
        const d = ((i - sel) % N + N + 2) % N;   // show a window of 5 cards centred on the selection
        const c = $(`card${i}`); c.classList.toggle('sel', i === sel); c.style.display = d < 5 ? '' : 'none'; c.style.order = String(d);
      });
    },
  };
}

export function setHint(t: string) { $('hint').textContent = t; }
export function setPill(ok: boolean, label: string) { $('pill').classList.toggle('ok', ok); ($('pill').lastElementChild as HTMLElement).textContent = label; }
export function setDebug(t: string | null) { const d = $('debug'); d.style.display = t === null ? 'none' : 'block'; if (t) d.textContent = t; }
export function setCross(x: number, y: number, on: boolean) { const c = $('cross'); c.style.display = on ? 'block' : 'none'; c.style.left = x + 'px'; c.style.top = y + 'px'; }
export function loaded() { $('loading').style.display = 'none'; }
export function loadingText(t: string) { $('loading').textContent = `LOADING ${t.toUpperCase()}`; }
