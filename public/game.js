import { createWorld, context, WORLD } from '/shared/game.mjs';

const $ = id => document.getElementById(id);
const canvas = $('world'), ctx = canvas.getContext('2d');
let state = createWorld(), session = null, source = null, playing = false, sequence = 0, online = false;
let lastEvent = '', toastUntil = 0, endingShown = false, camera = 0, w = 0, h = 0, scale = 1, lastFrame = performance.now();
let renderPlayers = new Map(), renderTruck = state.vehicle.x;
let keys = { left: false, right: false, jump: false }, pendingInput = false, lastSent = 0;
const palette = ['#bd6545', '#618c9a'];
const safeStore = { get(k) { try { return sessionStorage.getItem(k); } catch { return null; } }, set(k,v) { try { sessionStorage.setItem(k,v); } catch {} }, remove(k) { try { sessionStorage.removeItem(k); } catch {} } };
const saved = (() => { try { return JSON.parse(safeStore.get('together-session')); } catch { return null; } })();
if (saved) { $('resume').hidden = false; $('name').value = saved.name || ''; }
const inviteCode = new URLSearchParams(location.search).get('room');
if (inviteCode) { $('join-fields').hidden = false; $('code').value = inviteCode; }
function resize() { w = innerWidth; h = innerHeight; const dpr = Math.min(devicePixelRatio || 1, 2); canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr,0,0,dpr,0,0); scale = Math.max(.6, Math.min(1.45, h / 770)); }
addEventListener('resize', resize); resize();
async function api(path, data) {
  const r = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await r.json(); if (!r.ok) throw new Error(result.error || 'Connection failed'); return result;
}
async function enter(join = false, resume = false) {
  $('error').textContent = ''; $('create').disabled = $('join').disabled = $('resume').disabled = true;
  try {
    const name = $('name').value.trim() || 'Traveler';
    const code = resume ? saved.code : $('code').value.trim().toUpperCase();
    const result = await api(join || resume ? '/api/join' : '/api/rooms', { name, code, token: resume ? saved.token : undefined });
    session = { ...result, name }; delete session.state; state = result.state; sequence = result.sequence;
    safeStore.set('together-session', JSON.stringify(session));
    playing = true; document.body.classList.add('playing'); $('welcome').hidden = true; $('scene-caption').hidden = true; $('hud').hidden = false;
    renderTruck = state.vehicle.x; renderPlayers.clear();
    history.replaceState(null, '', '?room=' + session.code);
    source?.close(); source = new EventSource('/api/events?code=' + session.code + '&token=' + session.token);
    source.onmessage = e => { state = JSON.parse(e.data); online = true; updateHud(); };
    source.onerror = () => { online = false; keys = { left:false,right:false,jump:false }; $('connection').textContent = 'Reconnecting.'; };
    if (!resume && !safeStore.get('together-guide')) { $('guide').showModal(); safeStore.set('together-guide','1'); }
  } catch(e) { $('error').textContent = e.message; }
  finally { $('create').disabled = $('join').disabled = $('resume').disabled = false; }
}
$('lobby').addEventListener('submit', e => { e.preventDefault(); enter(); });
$('join-toggle').onclick = () => { $('join-fields').hidden = !$('join-fields').hidden; if (!$('join-fields').hidden) $('code').focus(); };
$('join').onclick = () => enter(true); $('resume').onclick = () => enter(true,true);
function toast(text) { $('toast').textContent = text; toastUntil = performance.now() + 6500; }
function me() { return state.players.find(p => p.id === session?.id); }
function updateHud() {
  const p = me(); if (!p) return;
  const connected = state.players.filter(p => p.connected).length;
  $('connection').textContent = `${connected}/2 travelers � ${session.code}`;
  $('objective').textContent = state.objective;
  $('route-progress').style.width = Math.min(100, Math.max(0, (state.vehicle.x - 430) / (WORLD.camp - 430) * 100)) + '%';
  $('solo-hint').hidden = connected > 1 || state.won;
  const crewKey = state.players.map(p => p.id+p.connected+p.station+p.carrying).join();
  if ($('crew').dataset.key !== crewKey) {
    $('crew').dataset.key = crewKey; $('crew').replaceChildren();
    for (const person of state.players) {
      const card = document.createElement('div'); card.className = 'crew-card';
      const dot = document.createElement('span'); dot.className = 'crew-color'; dot.style.background = palette[person.slot]; card.append(dot, document.createTextNode(person.name + (person.id === session.id ? ' (you)' : '')));
      const small = document.createElement('small'); small.textContent = !person.connected ? 'Away � place saved' : person.station === 'driver' ? 'At the wheel' : person.station === 'winch' ? 'On the winch' : person.carrying ? 'Carrying a plank' : 'Exploring'; card.append(small); $('crew').append(card);
    }
  }
  const c = context(state,p); $('interaction').hidden = !c || state.won;
  if (c) $('interaction').querySelector('span').textContent = c.label;
  const crossing = state.vehicle.x > 1480 && state.vehicle.x < 2130 && state.bridge === 3 && state.anchored;
  $('tension-box').hidden = !crossing; $('tension').value = state.tension;
  $('tension-label').textContent = state.tension < 15 ? 'Holding position. Wind the cable back up!' : 'Winch operator: hold SPACE';
  $('note-count').textContent = state.events.length;
  if (lastEvent !== state.lastEvent) { lastEvent = state.lastEvent; toast(lastEvent); }
  if (state.won && !endingShown) { endingShown = true; $('dog-ending').textContent = state.dog ? 'Moss has already picked his spot by the stove.' : 'You wonder if that dog by the road would have liked it here.'; $('ending').showModal(); }
}
function neutral() { keys = {left:false,right:false,jump:false}; sendInput(); }
async function sendInput() {
  if (!session || !online || pendingInput) return;
  pendingInput = true; lastSent = performance.now();
  try { await api('/api/input', { ...session, ...keys, sequence: ++sequence }); } catch { online = false; } finally { pendingInput = false; }
}
async function action() { if (!session || !online) return; try { await api('/api/interact', session); } catch(e) { toast(e.message); } }
const keyMap = { KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',Space:'jump' };
addEventListener('keydown', e => {
  if (!playing || document.querySelector('dialog[open]') || /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (keyMap[e.code]) { e.preventDefault(); keys[keyMap[e.code]] = true; sendInput(); }
  if (e.code === 'KeyE' && !e.repeat) { e.preventDefault(); action(); }
  if (e.code === 'KeyH' && !e.repeat) { neutral(); $('guide').showModal(); }
});
addEventListener('keyup', e => { if (keyMap[e.code]) { keys[keyMap[e.code]] = false; sendInput(); } });
addEventListener('blur', neutral); document.addEventListener('visibilitychange', () => { if (document.hidden) neutral(); });
for (const b of document.querySelectorAll('[data-key]')) {
  b.onpointerdown = e => { e.preventDefault(); b.setPointerCapture(e.pointerId); keys[b.dataset.key] = true; sendInput(); };
  b.onpointerup = b.onpointercancel = () => { keys[b.dataset.key] = false; sendInput(); };
}
$('touch-e').onclick = action;
for (const b of document.querySelectorAll('[data-close]')) b.onclick = () => $(b.dataset.close).close();
$('help').onclick = () => { neutral(); $('guide').showModal(); };
$('journal-button').onclick = () => { neutral(); $('notes').replaceChildren(); for (const event of state.events) { const p = document.createElement('div'); p.className = 'note'; p.textContent = event.text; $('notes').append(p); } if (!state.events.length) $('notes').textContent = 'The first page is still unwritten.'; $('journal').showModal(); };
$('invite').onclick = () => { neutral(); $('invite-url').value = location.origin + '/?room=' + session.code; $('trip-code').textContent = session.code; $('local-note').textContent = /localhost|127\.0\.0\.1/.test(location.hostname) ? 'This is a local preview. For different locations, deploy the included game server and share its HTTPS address. On the same Wi-Fi, use the host computer LAN address instead of localhost.' : 'The invitation joins this trip; it does not grant control of your traveler.'; $('invitation').showModal(); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText($('invite-url').value); $('copy').textContent = 'Copied �'; } catch { $('invite-url').select(); $('copy').textContent = 'Select and copy the link above'; } };
$('leave').onclick = () => { neutral(); source?.close(); location.href = '/'; };
$('stay').onclick = () => $('ending').close(); $('new-trip').onclick = () => { safeStore.remove('together-session'); location.href = '/'; };
let audioCtx;
$('sound').onclick = async () => {
  if (audioCtx) { if (audioCtx.state === 'running') { await audioCtx.suspend(); $('sound').textContent = 'Sound off'; } else { await audioCtx.resume(); $('sound').textContent = 'Sound on'; } return; }
  audioCtx = new AudioContext(); const gain = audioCtx.createGain(); gain.gain.value = .018; gain.connect(audioCtx.destination);
  for (const frequency of [130.81,196,261.63]) { const osc = audioCtx.createOscillator(); osc.type = 'sine'; osc.frequency.value = frequency; osc.connect(gain); osc.start(); }
  $('sound').textContent = 'Sound on';
};

// All scenery is drawn locally; the server owns movement, inventory, and progression.
function rect(x,y,width,height,color) { ctx.fillStyle=color; ctx.fillRect(x,y,width,height); }
function poly(points,color,stroke) { ctx.beginPath(); points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y)); ctx.closePath();ctx.fillStyle=color;ctx.fill();if(stroke){ctx.strokeStyle=stroke;ctx.lineWidth=2;ctx.stroke();} }
function line(x,y,x2,y2,color,width=2) { ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.stroke(); }
function circle(x,y,r,color) {ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
function text(str,x,y,size=12,color='#425747',font='Arial',align='center') {ctx.font=`${size}px ${font}`;ctx.textAlign=align;ctx.fillStyle=color;ctx.fillText(str,x,y);}
function random(n) { const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x); }
function pine(x,y,height,color) { rect(x-3,y-height*.7,6,height*.7,'#56644c'); for(let i=0;i<3;i++){const top=y-height+i*height*.2;poly([[x,top],[x-height*(.22+i*.04),top+height*.53],[x+height*(.22+i*.04),top+height*.53]],color);} }
function mountains(cam, factor, base, amplitude, color) { const pts=[[-100,850]];for(let x=-100;x<=w/scale+100;x+=35){const wx=x+cam*factor;pts.push([x,base-Math.sin(wx*.003)*amplitude-Math.sin(wx*.008+1.2)*amplitude*.3]);}pts.push([w/scale+100,850]);poly(pts,color); }
function scenery(time) {
  const sky=ctx.createLinearGradient(0,0,0,h);sky.addColorStop(0,'#e6e9d5');sky.addColorStop(.65,'#f5dfb7');sky.addColorStop(1,'#c6cbb3');rect(0,0,w,h,sky);
  ctx.save();ctx.scale(scale,scale);
  circle(w/scale*.72-camera*.018,137,48,'#f9f0cb');circle(w/scale*.72-camera*.018,137,64,'#f9f0cb25');
  mountains(camera,.09,315,48,'#bdc5b0'); mountains(camera,.18,385,65,'#9dac97');mountains(camera,.3,441,50,'#819880');
  for(let i=-10;i<95;i++){const x=i*84-camera*.42; if(x>-80&&x<w/scale+80)pine(x,510,65+random(i)*125,'#748e74');}
  for(let i=-10;i<90;i++){const x=i*97-camera*.67;if(x>-80&&x<w/scale+80)pine(x,535,70+random(i+12)*160,'#58775e');}
  // Wisps and distant birds.
  for(let i=0;i<3;i++){const x=((time*5+i*280)%(w/scale+200))-100; const y=165+i*24;line(x-5,y,x,y+3,'#748171',1);line(x,y+3,x+5,y,'#748171',1);}
  ctx.restore();
}
function ground(time) {
  rect(-300,520,5100,400,'#687458');rect(-300,520,5100,13,'#9a9b70');rect(-300,533,5100,7,'#b5a981');
  for(let i=0;i<150;i++){const x=i*31;rect(x,545+random(i)*200,3+random(i+1)*14,2,'#7e8060');}
  // River cut and banks.
  poly([[1590,520],[1635,630],[1980,630],[2025,520]],'#657c70');rect(1620,560,370,150,'#81a9a5');
  for(let i=0;i<16;i++){const x=1640+random(i)*315;line(x+Math.sin(time+i)*5,578+i*7,x+35+Math.sin(time+i)*5,578+i*7,'#b4ccc1',1);}
  for(const x of [1660,1750,1840,1930]){poly([[x-24,547],[x-19,537],[x+10,531],[x+24,537],[x+28,555]],'#7a8272');line(x-16,537,x+9,534,'#b9b79c',3);}
  // Weathered bridge with three repaired sections.
  for(const x of [1607,2004]){rect(x,496,12,97,'#665946');rect(x-3,496,18,7,'#b4a080');}
  for(let i=0;i<3;i++){const x=1618+i*126;if(i<state.bridge){rect(x,511,128,12,'#a38359');for(let b=0;b<8;b++){rect(x+b*16,510,14,4,'#bca078');line(x+b*16,514,x+b*16+8,519,'#836a49',1);}}else{line(x,516,x+25,535,'#735f44',6);}}
  if(state.anchored){ctx.beginPath();ctx.moveTo(1605,489);ctx.quadraticCurveTo(1810,515+(100-state.tension)*.16,2070,492);ctx.strokeStyle='#535e50';ctx.lineWidth=3;ctx.stroke();}
  rect(2063,477,13,43,'#768071');circle(2070,480,10,'#515f53');circle(2070,480,5,'#c6c1a1');
  for(let i=0;i<100;i++){const x=i*43+random(i)*12;if(x>1580&&x<2040)continue; const y=518;line(x,y,x-3,y-7-random(i)*7,'#657b4d',2);line(x,y,x+4,y-5,'#657b4d',2);if(i%7===0){circle(x+4,y-8,2,'#e2c895');}}
  // Shelter at the old depot.
  rect(85,406,103,114,'#8a927b');poly([[71,410],[133,370],[202,410]],'#666d57');rect(101,439,29,42,'#c6c6a5');rect(148,448,23,72,'#5c6c57');line(95,481,180,481,'#667461',3);
  sign(720,'COAST ROAD','STILLWATER  '); sign(1440,'OLD BRIDGE','CROSS WITH CARE');sign(3240,'STILLWATER','JUST A LITTLE FURTHER');
  for(const stack of state.planks){for(let i=0;i<stack.count;i++){rect(stack.x-23+i*3,510-i*9,49,7,'#b18c5b');line(stack.x-16,513-i*9,stack.x+22,513-i*9,'#795e3c',1);}if(stack.count)marker(stack.x,474,'SALVAGE');}
  // Mara's roadside repair stand.
  rect(1047,405,5,115,'#756850');rect(1172,405,5,115,'#756850');poly([[1030,414],[1187,414],[1161,379],[1057,379]],'#ae7452');for(let i=0;i<6;i++)rect(1031+i*26,414,13,8,'#ddd0a5');rect(1060,492,50,28,'#a9946d');circle(1085,479,11,'#858b72');person({x:1120,y:520,slot:1,station:null,carrying:false},time,false,'Mara');
  // Fallen pine rotates aside as the winch pulls.
  ctx.save();ctx.translate(2780,518);ctx.rotate(-state.treeProgress/100*1.28);line(-75,-18,83,-67,'#695a41',25);line(-77,-26,80,-73,'#968161',5);for(let i=0;i<5;i++){const x=-35+i*23;line(x,-34-i*6,x+8,-79-i*5,'#6b6548',6);poly([[x-18,-63-i*4],[x+9,-107-i*4],[x+40,-77-i*4]],'#506f53');}ctx.restore();
  if(state.treeCable&&state.treeProgress<100)line(state.vehicle.x+153,463,2720,497,'#4d5d53',2);
  if(!state.dog)dog(2340,518,time);
  // Stillwater campsite, lake and a quiet light.
  rect(3420,560,780,180,'#94aaa0');for(let i=0;i<12;i++)line(3450+i*47,580+i%4*13,3480+i*47,580+i%4*13,'#bed0b8',2);
  pine(3430,520,190,'#47654d');pine(3860,520,240,'#45634e');rect(3597,474,6,46,'#6c6c52');poly([[3579,478],[3620,478],[3600,457]],'#77654b');circle(3600,485,10,'#f4d593');
  for(let i=0;i<7;i++)circle(3795+Math.cos(i)*19,518+Math.sin(i)*5,5,'#808775');line(3782,514,3808,511,'#746146',6);if(state.won){poly([[3787,511],[3798,486-Math.sin(time*5)*5],[3803,512]],'#e4a15d');circle(3796,502,10,'#f8cb79');}
}
function sign(x,a,b){rect(x-3,468,6,52,'#80765b');rect(x-61,440,122,34,'#d6c99e');text(a,x,453,8,'#59634b');text(b,x,465,6,'#687153');}
function marker(x,y,label){ if(!playing)return; text(label,x,y,7,'#e9e7cc');circle(x,y+9,2,'#e9e7cc'); }
function house(x,time) {
  const bob=Math.abs(state.vehicle.speed)>1?Math.sin(time*13)*1.2:0;
  ctx.save();ctx.translate(x, bob);
  const wheel=(wx)=>{circle(wx,497,23,'#35483c');circle(wx,497,14,'#838773');circle(wx,497,6,'#c4bb98');for(let i=0;i<6;i++){const angle=i*Math.PI/3+x*.035;line(wx+Math.cos(angle)*7,497+Math.sin(angle)*7,wx+Math.cos(angle)*13,497+Math.sin(angle)*13,'#536351',2);}};
  wheel(-105);wheel(105);rect(-157,468,317,14,'#374d41');rect(-149,475,38,6,'#aa7650');rect(135,475,33,6,'#aa7650');
  // Outer cabin and cutaway interior.
  rect(-153,327,308,139,'#c4ba8d');rect(-140,341,282,109,'#e2d5af');rect(-140,431,282,20,'#c4af82');
  for(let i=0;i<11;i++)line(-140+i*27,342,-140+i*27,434,'#d1c39b',1);
  rect(-134,353,58,43,'#91aaa0');rect(-43,353,61,43,'#91aaa0');rect(43,353,71,43,'#a2b8a9');
  for(const xx of [-134,-43,43]){line(xx,373,xx+56,373,'#eadfb9',3);line(xx+27,353,xx+27,396,'#eadfb9',3);}
  // Back bunk, stove, shelves and plant.
  rect(-119,422,57,19,'#938f6e');rect(-121,416,59,11,'#be7352');rect(-120,412,17,8,'#ebe2c1');rect(-116,440,5,10,'#766b51');rect(-72,440,5,10,'#766b51');
  rect(-34,421,25,29,'#546459');rect(-32,427,21,15,'#d69a58');rect(-28,431,13,7,'#f3c57b');rect(-29,385,6,36,'#6c7764');
  rect(20,406,46,5,'#95805a');rect(22,397,8,9,'#96734e');rect(36,392,5,14,'#788770');rect(43,389,6,17,'#b87654');
  rect(50,431,36,5,'#9a8056');rect(52,436,4,14,'#85744f');rect(81,436,4,14,'#85744f');rect(67,422,11,9,'#b7835d');line(73,421,73,407,'#65845a',3);poly([[73,415],[61,407],[65,417]],'#718e61');poly([[73,413],[85,402],[82,416]],'#81966c');
  // Station hardware stays visible behind travelers.
  rect(-82,432,32,18,'#667465');circle(-65,428,12,'#727e6a');circle(-65,428,6,'#b6b49a');line(-65,426,-48,413,'#4e5e4f',3);circle(-48,413,4,'#ad754d');
  rect(112,411,14,39,'#827e61');line(112,420,101,406,'#516454',4);circle(99,404,11,'#425749');circle(99,404,7,'#b8bf9e');
  // Roof, luggage, climbing step.
  poly([[-168,328],[-155,308],[122,302],[172,328]],'#547569','#334f43');line(-153,310,122,305,'#87a08a',3);rect(-96,287,55,18,'#9f8660');rect(-91,282,45,7,'#b49c76');rect(-65,284,4,22,'#71694d');rect(-24,291,53,13,'#889077');line(-22,290,28,290,'#c5b996',3);rect(91,280,14,23,'#5b6a5b');rect(86,278,24,6,'#62725f');
  for(let i=0;i<3;i++){circle(100+Math.sin(time+i)*5+i*6,266-i*16-(time*9%14),6+i*3,'#e8e4c433');}
  rect(-153,340,10,126,'#56776a');rect(142,337,13,129,'#56776a');rect(-153,451,308,16,'#648576');line(-151,453,153,453,'#90a18b',3);rect(-168,477,21,6,'#69745d');
  rect(156,435,8,15,'#ebca7c');circle(160,442,12,'#f4d79222');rect(-159,440,5,12,'#b9744a');
  // Small roof pennant.
  line(-140,309,-140,272,'#777354',2);poly([[-140,272],[-111,280+Math.sin(time*2)*2],[-140,287]],'#c27a52');
  if(playing){text('WINCH',-65,362,6,'#5e705f');text('DRIVE',109,362,6,'#5e705f');text(' OUT',-129,348,6,'#52644f');}
  if(state.dog)dog(16,449,time);
  ctx.restore();
}
function dog(x,y,time){const wag=Math.sin(time*7)*4;rect(x-14,y-16,25,12,'#bca780');rect(x+7,y-25,15,14,'#c8b38b');poly([[x+7,y-25],[x+6,y-33],[x+15,y-26]],'#6e6b50');poly([[x+16,y-26],[x+22,y-32],[x+23,y-24]],'#6e6b50');rect(x+18,y-18,8,5,'#d5c4a0');rect(x+24,y-18,3,3,'#394f3e');rect(x+17,y-23,2,2,'#394f3e');rect(x-12,y-5,4,6,'#7f785a');rect(x+5,y-5,4,6,'#7f785a');line(x-14,y-12,x-25,y-23+wag,'#bca780',5);rect(x+8,y-13,12,3,'#a26042');}
function person(p,time,mine=false,label) {
  const rp=renderPlayers.get(p.id)||p,x=rp.x,y=rp.y;
  const moving=playing&&p.id===session?.id&&(keys.left||keys.right)&&!p.station;
  const stride=moving?Math.sin(time*12)*4:0;
  ctx.save();if(p.connected===false)ctx.globalAlpha=.4;
  circle(x,y+1,10,'#293e3025');rect(x-7,y-17,5,16+stride*.3,'#42584c');rect(x+2,y-17,5,16-stride*.3,'#42584c');rect(x-9,y-3,8,4,'#3e5041');rect(x+1,y-3,9,4,'#3e5041');
  rect(x-10,y-35,20,22,palette[p.slot]||palette[0]);rect(x-13,y-33,5,18+stride,'#d0ac7e');rect(x+8,y-33,5,18-stride,'#d0ac7e');rect(x-6,y-49,15,16,'#dcb78a');rect(x-8,y-50,18,7,p.slot===1?'#544a39':'#756246');rect(x-8,y-44,4,7,p.slot===1?'#544a39':'#756246');rect(x+5,y-42,2,2,'#334a3c');
  if(p.slot===0){rect(x-10,y-52,22,5,'#c49b66');rect(x-5,y-58,13,8,'#c49b66');}else{rect(x-9,y-53,20,6,'#789796');rect(x-6,y-58,14,8,'#789796');}
  if(p.carrying){ctx.save();ctx.translate(x,y-40);ctx.rotate(-.2);rect(-27,-3,54,7,'#bb9662');line(-22,0,20,0,'#8b6e45',1);ctx.restore();}
  if(mine){poly([[x-4,y-72],[x+4,y-72],[x,y-67]],'#f6eed0');}
  if(label||playing){const title=label||p.name;ctx.font='8px Arial';const tw=ctx.measureText(title).width;rect(x-tw/2-6,y-89,tw+12,15,'#faf1dccc');text(title,x,y-78,8,'#415640');}
  ctx.restore();
}
function frame(now) {
  const dt=Math.min((now-lastFrame)/1000,.1);lastFrame=now;const t=now/1000;
  const target=playing?(me()?.x||state.vehicle.x):680;
  const targetCam=playing?Math.max(-70,Math.min(WORLD.width-w/scale+150,target-w/scale*.48)):680-w/scale*.72;
  camera+=(targetCam-camera)*Math.min(1,dt*4);
  renderTruck+=(state.vehicle.x-renderTruck)*Math.min(1,dt*15);
  for(const p of state.players){let r=renderPlayers.get(p.id);if(!r){r={x:p.x,y:p.y};renderPlayers.set(p.id,r);}r.x+=(p.x-r.x)*Math.min(1,dt*18);r.y+=(p.y-r.y)*Math.min(1,dt*18);}
  scenery(t);
  ctx.save();ctx.scale(scale,scale);ctx.translate(-camera, h/scale*.73-520);
  ground(t);house(playing?renderTruck:720,t);
  if(playing){for(const p of state.players)person(p,t,p.id===session?.id);}else{person({x:807,y:450,slot:0},t);person({x:690,y:450,slot:1},t);dog(940,519,t);}
  // Foreground plants frame the road without obscuring interactions.
  for(let i=0;i<55;i++){const x=i*91+21;if(x>1610&&x<2010)continue;const y=640+random(i)*60;for(let j=0;j<3;j++)line(x,y,x+(j-1)*9,y-20-random(i+j)*17,'#48684f',3);}
  ctx.restore();
  $('toast').classList.toggle('show',now<toastUntil);
  if(playing&&now-lastSent>180)sendInput();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
