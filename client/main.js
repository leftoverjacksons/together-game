import { Game } from './game.js';
import { OnlineSession, LocalSession } from './session.js';
import { Audio } from './audio.js';

const audio = new Audio();
// Browsers can suspend audio (tab switches, focus loss); resume on any interaction.
const resumeAudio = () => { if (audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume(); };
for (const ev of ['pointerdown', 'keydown', 'focus']) addEventListener(ev, resumeAudio);
document.addEventListener('visibilitychange', () => { if (!document.hidden) resumeAudio(); });

const $ = id => document.getElementById(id);
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

const params = new URLSearchParams(location.search);
$('name').value = store.get('together:name') || '';
if (params.get('trip')) { $('code').value = params.get('trip').toUpperCase(); $('join').classList.add('primary'); }

function name() { const n = $('name').value.trim() || 'Traveller'; store.set('together:name', n); return n; }
function fail(msg) { $('menu-error').textContent = msg; }

const hud = {
  status(s, detail) {
    const el = $('status');
    el.textContent = { connecting: 'Connecting…', online: 'Online', reconnecting: 'Reconnecting…', offline: 'Practice (offline)', error: detail || 'Disconnected' }[s] || s;
    el.dataset.state = s;
    if (s === 'error') { $('menu').hidden = false; fail(detail || 'Could not join.'); }
  },
  toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(this._toast);
    this._toast = setTimeout(() => (el.hidden = true), 3200);
  },
  joined(code) {
    $('menu').hidden = true;
    $('hud').hidden = false;
    if (code) {
      $('trip').hidden = false;
      $('trip-code').textContent = code;
      history.replaceState(null, '', '?trip=' + code);
    }
  },
  update({ prompt, soil, tipped, mass, players, myId, tool, tools, boards, boardCap, rack, lane, wet }) {
    const bar = tools.map((t, k) => `<span class="slot${k === tool ? ' on' : ''}${t.icon ? '' : ' empty'}"><i>${k + 1}</i>${t.icon ? `<img src="${t.icon}" alt="">` : ''}${t.name}</span>`).join('') + '<span class="slot bag"><i>Tab</i>Inventory</span>';
    if (bar !== this._bar) { $('toolbar').innerHTML = bar; this._bar = bar; }
    $('boards').textContent = `Boards ${boards}/${boardCap}`;
    $('rack').textContent = rack ? 'Rack: ' + rack : '';
    $('lane').textContent = lane + (wet ? ' · raining' : '');
    if (prompt !== this._prompt) { $('prompt').innerHTML = prompt; $('prompt').hidden = !prompt; this._prompt = prompt; }
    $('soil-fill').style.width = Math.round(soil * 100) + '%';
    $('tipped').hidden = !tipped;
    $('mass').textContent = mass ? mass.toLocaleString() + ' kg' : '';
    const list = players.map(p => `${p.id === myId ? '● ' : ''}${escape(p.name)}${p.connected ? '' : ' (away)'}`).join(' &nbsp;·&nbsp; ');
    if (list !== this._list) { $('players').innerHTML = list; this._list = list; }
  },
};
const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let game = null;
function launch(session) {
  audio.start();
  if (game) { game.session.close(); game.session = session; session.onmessage = m => game.onMessage(m); session.onstatus = (s, d) => hud.status(s, d); session.connect(); return; }
  game = new Game(session, hud, audio);
  window.__together = game;   // debugging handle
  game.start($('stage'));
}

$('create').onclick = async () => {
  audio.start();
  fail('');
  try {
    const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const data = await r.json();
    if (!r.ok) return fail(data.error || 'Could not start a trip.');
    launch(new OnlineSession(data.code, name()));
  } catch { fail('Could not reach the server.'); }
};
$('join').onclick = () => {
  audio.start();
  fail('');
  const code = $('code').value.trim().toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(code)) return fail('Trip codes are six letters and numbers.');
  launch(new OnlineSession(code, name()));
};
$('practice').onclick = () => { audio.start(); fail(''); launch(new LocalSession(name())); };
$('copy').onclick = async () => {
  const link = location.origin + '/?trip=' + $('trip-code').textContent;
  try { await navigator.clipboard.writeText(link); $('copy').textContent = 'Copied'; } catch { prompt('Invite link', link); }
  setTimeout(() => ($('copy').textContent = 'Copy invite link'), 1500);
};
$('help-toggle').onclick = () => ($('help').hidden = !$('help').hidden);
addEventListener('keydown', e => { if (e.key.toLowerCase() === 'h' && !(e.target instanceof HTMLInputElement)) $('help').hidden = !$('help').hidden; });
