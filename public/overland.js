import {createWorld,context,WORLD,TOOLS,pose,surface,tile,initialSurface,clamp,targetMenu,terrainMesh} from '/shared/game.mjs';
const $=id=>document.getElementById(id),canvas=$('world'),ctx=canvas.getContext('2d');
let state=createWorld(),session=null,source=null,playing=false,online=false,sequence=0,pending=false,lastSent=0;
let w=innerWidth,h=innerHeight,zoom=1,camX=0,camY=230,lastFrame=performance.now(),lastEvent='',toastUntil=0,endingShown=false;
let mouse={x:0,y:0,active:false},renderPose={...state.vehicle},renderPeople=new Map(),terrainVersion=-1;
let brush=null,radialTarget=null;
let keys={left:false,right:false,jump:false,down:false,brake:false,work:false,aimX:0,aimY:0};
const colors=['#c27750','#749a9b'];
const local={get(k){try{return sessionStorage.getItem(k);}catch{return null;}},set(k,v){try{sessionStorage.setItem(k,v);}catch{}},remove(k){try{sessionStorage.removeItem(k);}catch{}}};
const saved=(()=>{try{return JSON.parse(local.get('together-session'));}catch{return null;}})();
if(saved){$('resume').hidden=false;$('name').value=saved.name||'';}
const room=new URLSearchParams(location.search).get('room');if(room){$('join-fields').hidden=false;$('code').value=room;}
function resize(){w=innerWidth;h=innerHeight;const d=Math.min(devicePixelRatio||1,2);canvas.width=w*d;canvas.height=h*d;ctx.setTransform(d,0,0,d,0,0);}
addEventListener('resize',resize);resize();
function scale(){return Math.max(.55,Math.min(1.3,h/850))*zoom;}
async function api(path,data){const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const v=await r.json();if(!r.ok)throw Error(v.error||'Connection failed');return v;}
function auth(){return {code:session.code,token:session.token};}
async function enter(join=false,resume=false){$('error').textContent='';$('create').disabled=$('join').disabled=$('resume').disabled=true;
  try{const name=$('name').value.trim()||'Traveler',code=resume?saved.code:$('code').value.trim().toUpperCase();const r=await api(join||resume?'/api/join':'/api/rooms',{name,code,token:resume?saved.token:undefined});
    state=r.state;sequence=r.sequence;session={code:r.code,token:r.token,id:r.id,name};local.set('together-session',JSON.stringify(session));playing=true;document.body.classList.add('playing');$('welcome').hidden=$('scene-caption').hidden=true;$('hud').hidden=false;history.replaceState(null,'','?room='+r.code);renderPose={...state.vehicle};terrainVersion=-1;
    camX=state.vehicle.x-w/scale()*.45;camY=state.vehicle.y-h/scale()*.6;source?.close();source=new EventSource('/api/events?code='+r.code+'&token='+r.token);
    source.onmessage=e=>{const next=JSON.parse(e.data);state={...next,terrain:next.terrain??state.terrain};online=true;updateHud();};
    source.onerror=()=>{online=false;clearKeys();$('connection').textContent='Reconnecting...';};
    if(!local.get('overland-guide')){$('guide').showModal();local.set('overland-guide','1');}
  }catch(e){$('error').textContent=e.message;}finally{$('create').disabled=$('join').disabled=$('resume').disabled=false;}
}
$('lobby').onsubmit=e=>{e.preventDefault();enter();};$('join-toggle').onclick=()=>{$('join-fields').hidden=!$('join-fields').hidden;if(!$('join-fields').hidden)$('code').focus();};$('join').onclick=()=>enter(true);$('resume').onclick=()=>enter(true,true);
function me(){return state.players.find(p=>p.id===session?.id);}
function toast(t){$('toast').textContent=t;toastUntil=performance.now()+7000;}
function updateHud(){const p=me();if(!p)return;const count=state.players.filter(q=>q.connected).length;
  $('connection').textContent=`${count}/2 travelers / ${session.code}`;$('objective').textContent=state.objective;
  $('route-progress').style.width=clamp((state.vehicle.x-370)/(WORLD.camp-370)*100,0,100)+'%';
  $('solo-hint').hidden=count>1;$('solo-hint').textContent=p.station==='driver'?'Solo: SPACE reels in the attached cable. S pays it out.':'Scout, shape the ground, and choose an anchor before driving.';
  const key=state.players.map(q=>q.id+q.connected+q.station+q.held).join();if($('crew').dataset.key!==key){$('crew').dataset.key=key;$('crew').replaceChildren();for(const q of state.players){const card=document.createElement('div');card.className='crew-card';const dot=document.createElement('span');dot.className='crew-color';dot.style.background=colors[q.slot];card.append(dot,document.createTextNode(q.name+(q.id===p.id?' (you)':'')));const desc=document.createElement('small');desc.textContent=!q.connected?'Away':q.station==='driver'?'At the wheel':q.station==='winch'?'Winch operator':q.held?'Carrying timber':'Surveying';card.append(desc);$('crew').append(card);}}
  const c=context(state,p);$('interaction').hidden=!c;if(c)$('interaction').querySelector('span').textContent=c.label;
  $('soil-count').textContent=state.soil;$('grade').textContent=Math.round(-state.vehicle.angle*180/Math.PI)+' deg';$('traction').textContent=state.vehicle.grounded+'/2 wheels';$('speed').textContent=Math.round(Math.abs(state.vehicle.speed)/12)+' km/h';$('brake-status').textContent=state.vehicle.brake?'BRAKE ON':'ROLLING';
  $('tension-box').hidden=!state.cable;if(state.cable){$('tension').value=state.cable.load;$('tension-label').textContent=state.cable.load>90?'Winch at load limit. Improve the approach.':Math.round(state.cable.length)+' units / SPACE in / S out';}
  for(const b of document.querySelectorAll('[data-tool]')){b.classList.toggle('selected',b.dataset.tool===p.tool);b.setAttribute('aria-pressed',String(b.dataset.tool===p.tool));}
  $('tool-description').textContent=p.inside?(p.station==='driver'?'A / D throttle. SHIFT brake. E leave station.':p.station==='winch'?'Hold SPACE to reel in. Hold S to pay out.':'Walk left to the rear door. E to step outside.'):({dig:'Hold mouse on nearby soil to excavate. Dark bedrock stays.',fill:'Hold mouse to place soil against existing ground.',cable:'Click a highlighted tree or rock. Click it again to release.',saw:'Hold mouse on a trunk to fell it. Keep clear of the fall.',timber:'Click a log to carry it. Q / R rotate. E sets it down.'}[p.tool]);
  $('tool-description').textContent=brush?`${brush==='dig'?'Digging':'Placing soil'}: hold mouse to work. Right-click or Esc to change action.`:'Click the house, trees, rocks, timber or ground for actions.';
  $('brush-done').hidden=!brush;
  $('rollover').hidden=Math.cos(state.vehicle.angle)>.3;
  $('note-count').textContent=state.events.length;if(lastEvent!==state.lastEvent){lastEvent=state.lastEvent;toast(lastEvent);}
  if(state.won&&!endingShown){endingShown=true;$('dog-ending').textContent=state.dog?'Moss has claimed the warm spot by the stove.':'';clearKeys();$('ending').showModal();}
}
function clearKeys(){keys={left:false,right:false,jump:false,down:false,brake:false,work:false,aimX:keys.aimX,aimY:keys.aimY};sendInput();}
async function sendInput(){if(!session||!online||pending)return;pending=true;lastSent=performance.now();try{await api('/api/input',{...auth(),...keys,sequence:++sequence});}catch(e){toast(e.message);}finally{pending=false;}}
async function action(){if(!online)return;try{await api('/api/interact',auth());}catch(e){toast(e.message);}}
async function tool(action){if(!online)return;try{await api('/api/tool',{...auth(),action});}catch(e){toast(e.message);}}
function closeRadial(){radialTarget=null;$('radial').hidden=true;}
function stopBrush(){brush=null;keys.work=false;sendInput();$('brush-done').hidden=true;}
function openRadial(e){stopBrush();clearKeys();aim(e);const x=keys.aimX,y=keys.aimY,m=targetMenu(state,me(),x,y);radialTarget={x,y};const root=$('radial');root.style.left=clamp(e.clientX,145,w-145)+'px';root.style.top=clamp(e.clientY,145,h-145)+'px';$('radial-title').textContent=m.title;$('radial-options').replaceChildren();$('radial-hint').textContent=m.actions.length?'Choose an action':'This rock is too hard to dig';
  m.actions.forEach((a,i)=>{const b=document.createElement('button');b.type='button';b.textContent=a.label;b.className='radial-action';const angle=-Math.PI/2+i*2*Math.PI/m.actions.length;b.style.left=(Math.cos(angle)*91)+'px';b.style.top=(Math.sin(angle)*91)+'px';b.disabled=!!a.disabled;b.title=a.disabled?a.reason:a.label;b.onclick=()=>chooseRadial(a,x,y);$('radial-options').append(b);});
  const disabled=m.actions.find(a=>a.disabled);if(disabled)$('radial-hint').textContent=disabled.reason;root.hidden=false;
}
async function chooseRadial(option,x,y){closeRadial();if(option.id==='right'){await tool({recover:true,near:true});clearKeys();return;}
  await tool({menu:option.id,x,y});if(option.tool==='dig'||option.tool==='fill'){brush=option.tool;toast(brush==='dig'?'Hold the mouse to dig. Esc returns to clicking.':'Hold the mouse to build. Esc returns to clicking.');}
  if(option.tool==='saw')toast('Cutting the tree. Move or press Esc to stop.');
}
$('radial-close').onclick=closeRadial;$('brush-done').onclick=stopBrush;$('right-house').onclick=()=>{clearKeys();closeRadial();tool({recover:true,near:true});};
const keyMap={KeyA:'left',ArrowLeft:'left',KeyD:'right',ArrowRight:'right',Space:'jump',KeyS:'down',ArrowDown:'down',ShiftLeft:'brake',ShiftRight:'brake'};
addEventListener('keydown',e=>{if(!playing||document.querySelector('dialog[open]')||/INPUT/.test(e.target.tagName))return;
  if(e.code==='Escape'){closeRadial();stopBrush();tool({cancel:true});return;}
  if(keyMap[e.code]){e.preventDefault();keys[keyMap[e.code]]=true;sendInput();}
  if(e.repeat)return;if(e.code==='KeyE')action();if(e.code==='KeyH'){clearKeys();$('guide').showModal();}
  if(/^Digit[1-5]$/.test(e.code)){const selected=TOOLS[Number(e.code.slice(-1))-1];tool({select:selected});brush=['dig','fill'].includes(selected)?selected:null;closeRadial();}
  if(e.code==='KeyQ')tool({rotate:-1});if(e.code==='KeyR')tool({rotate:1});
});
addEventListener('keyup',e=>{if(keyMap[e.code]){keys[keyMap[e.code]]=false;sendInput();}});addEventListener('blur',clearKeys);document.addEventListener('visibilitychange',()=>{if(document.hidden)clearKeys();});
function aim(e){mouse={x:e.clientX,y:e.clientY,active:true};keys.aimX=camX+mouse.x/scale();keys.aimY=camY+mouse.y/scale();}
canvas.onpointermove=aim;canvas.onpointerdown=e=>{if(!playing||document.querySelector('dialog[open]'))return;e.preventDefault();aim(e);const m=targetMenu(state,me(),keys.aimX,keys.aimY),ground=['Soil','Bedrock','Build a ramp'].includes(m.title);if(brush&&ground&&e.button!==2){closeRadial();canvas.setPointerCapture(e.pointerId);keys.work=true;sendInput();}else openRadial(e);};canvas.onpointerup=canvas.onpointercancel=()=>{keys.work=false;sendInput();};canvas.oncontextmenu=e=>e.preventDefault();
canvas.addEventListener('wheel',e=>{if(!playing)return;e.preventDefault();zoom=clamp(zoom-e.deltaY*.0007,.65,1.35);},{passive:false});
for(const b of document.querySelectorAll('[data-tool]'))b.onclick=()=>tool({select:b.dataset.tool});
for(const b of document.querySelectorAll('[data-key]')){b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys[b.dataset.key]=true;sendInput();};b.onpointerup=b.onpointercancel=()=>{keys[b.dataset.key]=false;sendInput();};}
$('touch-e').onclick=action;for(const b of document.querySelectorAll('[data-close]'))b.onclick=()=>$(b.dataset.close).close();
$('help').onclick=()=>{clearKeys();closeRadial();$('guide').showModal();};$('recover').onclick=()=>{clearKeys();$('recovery').showModal();};$('confirm-recover').onclick=()=>{tool({recover:true});$('recovery').close();};
$('journal-button').onclick=()=>{clearKeys();$('notes').replaceChildren();for(const event of state.events){const node=document.createElement('div');node.className='note';node.textContent=event.text;$('notes').append(node);}if(!state.events.length)$('notes').textContent='The road is still unwritten.';$('journal').showModal();};
$('invite').onclick=()=>{clearKeys();$('invite-url').value=location.origin+'/?room='+session.code;$('trip-code').textContent=session.code;$('local-note').textContent=/localhost|127\.0\.0\.1/.test(location.hostname)?'Local preview: use the deployed HTTPS address to invite someone in another location.':'Send this link to your fellow traveler.';$('invitation').showModal();};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('invite-url').value);$('copy').textContent='Copied';}catch{$('invite-url').select();}};
$('leave').onclick=()=>{clearKeys();source?.close();location.href='/';};$('stay').onclick=()=>$('ending').close();$('new-trip').onclick=()=>{local.remove('together-session');location.href='/';};
let audioCtx;$('sound').onclick=async()=>{if(audioCtx){if(audioCtx.state==='running'){await audioCtx.suspend();$('sound').textContent='Sound off';}else{await audioCtx.resume();$('sound').textContent='Sound on';}return;}audioCtx=new AudioContext();const gain=audioCtx.createGain();gain.gain.value=.014;gain.connect(audioCtx.destination);for(const f of [130.81,196,261.63]){const osc=audioCtx.createOscillator();osc.frequency.value=f;osc.connect(gain);osc.start();}$('sound').textContent='Sound on';};

function rect(x,y,w,h,c){ctx.fillStyle=c;ctx.fillRect(x,y,w,h);}
function line(x,y,x2,y2,c,width=2){ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.strokeStyle=c;ctx.lineWidth=width;ctx.stroke();}
function circle(x,y,r,c){ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=c;ctx.fill();}
function poly(pts,c){ctx.beginPath();pts.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=c;ctx.fill();}
function text(str,x,y,size=12,c='#425747',font='Arial'){ctx.font=`${size}px ${font}`;ctx.textAlign='center';ctx.fillStyle=c;ctx.fillText(str,x,y);}
function rand(n){const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);}
function pine(x,y,height,c){
  ctx.save();ctx.translate(x,y);line(0,-height*.72,0,0,'#766a4c',Math.max(5,height*.036));line(-1,-height*.7,-1,-4,'#af9570',1.4);
  // A single irregular bough silhouette with layered light, not stacked triangles.
  for(let layer=0;layer<3;layer++){
    const top=-height+layer*height*.20,wide=height*(.20+layer*.025),bottom=top+height*.52;
    ctx.beginPath();ctx.moveTo(0,top);
    for(let j=1;j<=5;j++){const yy=top+(bottom-top)*j/5,ww=wide*j/5;ctx.quadraticCurveTo(-ww*.45,yy-height*.035,-ww,yy);ctx.lineTo(-ww*.52,yy-2);}
    ctx.quadraticCurveTo(0,bottom+height*.035,wide,bottom);
    for(let j=4;j>=1;j--){const yy=top+(bottom-top)*j/5,ww=wide*j/5;ctx.lineTo(ww*.5,yy+height*.03);ctx.quadraticCurveTo(ww*.9,yy+height*.015,ww,yy);}
    ctx.closePath();ctx.fillStyle=c;ctx.fill();
    ctx.beginPath();ctx.moveTo(-2,top+8);ctx.quadraticCurveTo(-wide*.15,bottom-13,-wide*.75,bottom-2);ctx.quadraticCurveTo(-wide*.25,bottom+3,0,bottom);ctx.closePath();ctx.fillStyle='#d4df9e0d';ctx.fill();
  }ctx.restore();
}
const terrainCanvas=document.createElement('canvas');terrainCanvas.width=WORLD.width;terrainCanvas.height=WORLD.height;const tc=terrainCanvas.getContext('2d');
function drawTerrainCache(){
  if(terrainVersion===state.terrainVersion)return;terrainVersion=state.terrainVersion;
  tc.clearRect(0,0,WORLD.width,WORLD.height);const mesh=terrainMesh(state);
  tc.save();tc.beginPath();for(const p of mesh.polygons){tc.moveTo(p[0].x,p[0].y);for(let i=1;i<p.length;i++)tc.lineTo(p[i].x,p[i].y);tc.closePath();}
  const earth=tc.createLinearGradient(0,360,0,1250);earth.addColorStop(0,'#bba17b');earth.addColorStop(.5,'#9a8062');earth.addColorStop(1,'#656d5c');tc.fillStyle=earth;tc.fill();tc.clip();
  // Long mineral strata replace repeated square tile patterns.
  tc.fillStyle='#737b68';tc.beginPath();tc.moveTo(0,1280);for(let x=0;x<=4480;x+=12)tc.lineTo(x,initialSurface(x)+220+Math.sin(x*.014)*7);tc.lineTo(4480,1280);tc.closePath();tc.fill();
  for(let row=0;row<10;row++){tc.beginPath();for(let x=0;x<=4480;x+=24){const y=initialSurface(x)+58+row*65+Math.sin(x*.006+row)*14;x?tc.lineTo(x,y):tc.moveTo(x,y);}tc.strokeStyle=row<3?'#ccb48c25':'#b1b49925';tc.lineWidth=3+row%3;tc.stroke();}
  for(let i=0;i<8500;i++){const x=rand(i*3)*4480,y=350+rand(i*3+1)*930;tc.fillStyle=i%3?'#392e2020':'#e7d6a92b';tc.beginPath();tc.ellipse(x,y,1+rand(i)*3,.5+rand(i+2)*1.3,rand(i)*3,0,Math.PI*2);tc.fill();}
  tc.restore();tc.lineCap='round';tc.lineJoin='round';
  for(const edge of mesh.segments){const {a,b,nx,ny}=edge;tc.beginPath();tc.moveTo(a.x,a.y);tc.lineTo(b.x,b.y);tc.strokeStyle=ny<-.45?'#637c4e':'#7f7356';tc.lineWidth=ny<-.45?5:2;tc.stroke();
    if(ny<-.55){tc.beginPath();tc.moveTo(a.x+nx,a.y+ny);tc.lineTo(b.x+nx,b.y+ny);tc.strokeStyle='#abb887';tc.lineWidth=2;tc.stroke();
      if(rand(a.x+a.y)>.56){const mx=(a.x+b.x)/2,my=(a.y+b.y)/2;tc.beginPath();tc.moveTo(mx-3,my);tc.quadraticCurveTo(mx-6,my-5,mx-5,my-8);tc.moveTo(mx,my);tc.quadraticCurveTo(mx+4,my-4,mx+5,my-6);tc.strokeStyle='#71834f';tc.lineWidth=1.4;tc.stroke();}}
  }
}
function background(t){const g=ctx.createLinearGradient(0,0,0,h);g.addColorStop(0,'#dce6dc');g.addColorStop(.65,'#eee4c6');g.addColorStop(1,'#c6ccad');rect(0,0,w,h,g);circle(w*.76-camX*.015,130,42,'#fff0c3');
  for(const [factor,base,amp,color] of [[.1,.45,70,'#becbb9'],[.2,.58,80,'#9eB69f'],[.35,.71,100,'#7f9b80']]){const pts=[[-100,h]];for(let x=-100;x<w+100;x+=25){const wx=x+camX*factor;pts.push([x,h*base-Math.sin(wx*.003)*amp-Math.sin(wx*.007)*amp*.4-camY*.10]);}pts.push([w+100,h]);poly(pts,color);}
  for(let i=-8;i<95;i++){const x=i*104-camX*.45;if(x>-100&&x<w+100)pine(x,h*.85-Math.sin(i*.8)*35-camY*.08,80+rand(i)*125,'#63856e');}
  for(let i=0;i<3;i++){const x=(t*5+i*260)%(w+100);line(x-5,130+i*21,x,133+i*21,'#82917a',1);line(x,133+i*21,x+5,130+i*21,'#82917a',1);}
}
function label(x,y,title){rect(x-48,y-15,96,19,'#f2e8ccda');text(title,x,y-2,8,'#52694f');}
function worldScene(t){drawTerrainCache();ctx.drawImage(terrainCanvas,0,0);
  for(const tree of state.trees){if(tree.cut<100){pine(tree.x,tree.y,tree.height,'#52765d');if(playing&&me()?.tool==='saw'&&tree.cut){rect(tree.x-22,tree.y-tree.height-15,44,4,'#394f41');rect(tree.x-22,tree.y-tree.height-15,44*tree.cut/100,4,'#e3b876');}if(playing&&me()?.tool==='cable'){circle(tree.x,tree.y-75,14,'#e4b46b88');text('ANCHOR',tree.x,tree.y-94,7,'#f2e8cc');}}else rect(tree.x-8,tree.y-13,17,13,'#94744f');}
  for(const rock of state.anchors){poly([[rock.x-19,rock.y+16],[rock.x-14,rock.y-3],[rock.x+6,rock.y-13],[rock.x+22,rock.y+4],[rock.x+17,rock.y+17]],'#7d8973');circle(rock.x,rock.y,5,'#ced0b4');if(playing&&me()?.tool==='cable'){circle(rock.x,rock.y,13,'#e4b46b88');text('ANCHOR',rock.x,rock.y-25,7,'#f2e8cc');}}
  for(const l of state.logs){line(l.a.x,l.a.y,l.b.x,l.b.y,'#654f37',23);line(l.a.x,l.a.y-3,l.b.x,l.b.y-3,'#a68456',15);circle(l.a.x,l.a.y,10,'#c7aa72');circle(l.a.x,l.a.y,5,'#a58253');circle(l.b.x,l.b.y,10,'#c7aa72');}
  for(const [x,a,b] of [[500,'LOW GEAR','SHAPE YOUR ROUTE'],[1450,'RIDGE LINE','CHECK YOUR BRAKES'],[2400,'PINE GULLY','LEAVE NO ONE BEHIND'],[3490,'HIGH PASS','STILLWATER AHEAD']]){const y=surface(state,x);rect(x-3,y-65,6,65,'#756e53');rect(x-66,y-85,132,35,'#ded0a5');text(a,x,y-70,8);text(b,x,y-58,6);}
  if(!state.dog)dog(2510,surface(state,2510),t);
  const cy=surface(state,4230);pine(4335,cy,180,'#486d53');line(4200,cy-4,4230,cy-7,'#745d3d',9);circle(4215,cy-12,8,state.won?'#edb65c':'#747e68');label(4210,cy-110,'STILLWATER');
  if(state.cable){const hook=state.vehicle.points[1];ctx.beginPath();ctx.moveTo(hook.x,hook.y);const dist=Math.hypot(state.cable.x-hook.x,state.cable.y-hook.y),sag=Math.max(0,state.cable.length-dist)*.35;ctx.quadraticCurveTo((hook.x+state.cable.x)/2,(hook.y+state.cable.y)/2+sag,state.cable.x,state.cable.y);ctx.strokeStyle=state.cable.load>90?'#ce704f':'#e6c481';ctx.lineWidth=3;ctx.stroke();circle(state.cable.x,state.cable.y,5,'#e6c481');}
}
function vehicle(t){const v=renderPose;
  for(let i=4;i<6;i++){const q=state.vehicle.points[i],mount=pose(v,i===4?-86:86,46);line(mount.x,mount.y,q.x,q.y,'#364f42',5);line(mount.x+5,mount.y,q.x+5,q.y,'#baad86',2);circle(q.x,q.y,36,'#293e34');circle(q.x-2,q.y-3,31,'#3c5244');circle(q.x,q.y,23,'#a0a38a');circle(q.x,q.y,17,'#737f68');circle(q.x,q.y,6,'#cbbd91');for(let j=0;j<8;j++){const a=j*Math.PI/4+v.x*.04;line(q.x+Math.cos(a)*25,q.y+Math.sin(a)*25,q.x+Math.cos(a)*33,q.y+Math.sin(a)*33,'#455d4e',3);}}
  ctx.save();ctx.translate(v.x,v.y);ctx.rotate(v.angle);
  roundBox(-124,-71,248,126,10,'#3d5d4c');roundBox(-121,-68,242,121,8,'#c8b794');const cabinLight=ctx.createLinearGradient(0,-60,0,42);cabinLight.addColorStop(0,'#e7d8b2');cabinLight.addColorStop(1,'#c9b084');roundBox(-112,-56,224,97,5,cabinLight);for(let i=0;i<10;i++)line(-108+i*23,-54,-108+i*23,36,'#d6c399',1);
  for(const x of [-101,-22,54]){roundBox(x-2,-50,55,37,5,'#937d5e');roundBox(x,-48,51,33,4,'#a5bbae');poly([[x+3,-45],[x+24,-45],[x+3,-22]],'#dce8d340');line(x+25,-48,x+25,-15,'#efdfb6',3);line(x,-31,x+51,-31,'#efdfb6',3);}
  roundBox(-111,23,58,16,4,'#b97550');line(-101,25,-101,35,'#d89469',2);line(-76,25,-76,35,'#d89469',2);roundBox(-107,18,18,9,4,'#eddfb7');rect(-12,12,25,28,'#596d5a');rect(-8,20,17,13,'#d29d56');rect(-3,-20,5,31,'#7e8165');
  rect(30,16,38,5,'#947a53');rect(35,21,4,20,'#947a53');rect(61,21,4,20,'#947a53');rect(43,7,10,9,'#b78558');line(48,7,48,-6,'#6c8b5c',2);poly([[48,0],[37,-10],[41,2]],'#729362');poly([[48,-1],[58,-12],[57,2]],'#729362');
  circle(-51,20,12,'#667862');circle(-51,20,6,'#bcb895');line(-51,20,-35,7,'#485f4e',3);circle(-35,7,4,'#b88b55');
  line(101,33,93,-1,'#5b6a54',4);circle(92,-2,10,'#49624e');circle(92,-2,6,'#bcbe99');
  rect(-124,40,249,15,'#5b8170');line(-122,43,123,43,'#95ad8c',3);rect(-124,-61,10,105,'#5b8170');rect(113,-61,11,105,'#5b8170');
  poly([[-128,-64],[-114,-78],[98,-78],[130,-64]],'#537b69');line(-111,-76,94,-76,'#9aae8d',2);roundBox(-62,-96,54,17,4,'#aa9068');line(-59,-92,-11,-92,'#c5ae83',2);rect(-39,-96,4,18,'#776c4c');rect(11,-91,42,12,'#80937a');rect(88,-102,11,25,'#617561');
  line(-107,-78,-107,-114,'#756f51',2);poly([[-107,-114],[-79,-106+Math.sin(t*2)*2],[-107,-98]],'#c58153');rect(124,20,7,12,'#f4d08a');
  if(playing){text('WINCH',-51,-44,6);text('DRIVE',94,-44,6);text('OUT',-102,-56,6);}if(state.dog)dog(22,39,t);
  ctx.restore();
}
function dog(x,y,t){
  ctx.save();ctx.translate(x,y);ctx.lineCap='round';oval(-1,0,21,3,'#263b3620');
  line(-11,-12,-10,-2,'#877c5b',5);line(7,-12,8,-2,'#9c8a65',5);oval(-1,-13,17,8,'#b9a77b');oval(-8,-15,9,7,'#817f60');
  ctx.beginPath();ctx.moveTo(-16,-15);ctx.quadraticCurveTo(-30,-20,-26,-28+Math.sin(t*6)*4);ctx.strokeStyle='#a7956d';ctx.lineWidth=5;ctx.stroke();
  oval(13,-23,10,10,'#c9b88d');poly([[5,-28],[7,-39],[14,-30]],'#626951');poly([[17,-30],[23,-39],[24,-25]],'#626951');oval(21,-20,7,4,'#e2ce9e');circle(27,-21,2.6,'#384d3d');circle(17,-26,1.3,'#344a38');line(9,-15,20,-14,'#b56f47',3);circle(16,-12,2,'#d7bc77');ctx.restore();
}
function oval(x,y,rx,ry,color,angle=0){ctx.beginPath();ctx.ellipse(x,y,rx,ry,angle,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();}
function roundBox(x,y,width,height,r,color){ctx.beginPath();ctx.roundRect(x,y,width,height,r);ctx.fillStyle=color;ctx.fill();}
function person(p,t){
  const r=renderPeople.get(p.id)||p,walking=!p.station&&(Math.abs(p.vx)>5||r.walking),phase=t*10+p.slot,bob=walking?Math.abs(Math.sin(phase))*1.7:Math.sin(t*2+p.slot)*.35,step=walking?Math.sin(phase)*7:0,face=r.face||1;
  ctx.save();ctx.translate(r.x,r.y);if(p.inside)ctx.rotate(renderPose.angle);if(!p.connected)ctx.globalAlpha=.4;
  oval(0,1,14,3,'#263b3628');ctx.scale(face,1);ctx.translate(0,-bob);ctx.lineCap='round';ctx.lineJoin='round';
  // Back arm, backpack, bent legs, jacket and front arm are separate layers.
  line(-5,-34,-8-step*.5,-21,'#bc9972',5);roundBox(-14,-38,10,20,4,'#8c8862');line(-11,-36,-11,-22,'#c0af7f',1.4);
  line(-4,-19,-7-step*.7,-10,'#3d5447',6);line(-7-step*.7,-10,-5-step, -3,'#435d4e',5);oval(-3-step,-1,6,3,'#344638');
  line(4,-18,5+step*.7,-10,'#4b6555',6);line(5+step*.7,-10,5+step,-3,'#526e5c',5);oval(7+step,-1,6,3,'#394e3f');
  roundBox(-9,-37,20,21,6,colors[p.slot]);line(2,-35,2,-19,p.slot?'#a3bbb3':'#dfa67c',1);roundBox(-4,-28,6,5,1,p.slot?'#52777a':'#a45e42');
  const working=p.task||p.held,handX=working?17:10-step*.5,handY=working?-28:-20;
  line(7,-33,12,-27,colors[p.slot],6);line(12,-27,handX,handY,'#d5af83',5);circle(handX,handY,2.8,'#e1bf91');
  roundBox(-1,-43,7,9,2,'#cda77c');oval(2,-47,9,10,'#e4bd8f');oval(0,-50,10,7,'#67563f');oval(5,-46,7,7,'#e4bd8f');oval(10,-45,3,2.2,'#e4bd8f');circle(7,-48,1.1,'#344739');line(6,-42,9,-42,'#aa775c',1);
  if(p.slot){roundBox(-8,-60,20,8,5,'#729b9a');roundBox(-9,-54,22,4,2,'#97b4aa');circle(-7,-48,2.5,'#6a5840');}
  else{roundBox(-7,-62,18,11,4,'#bc9a68');oval(3,-52,15,3,'#d0b381');line(-5,-54,11,-54,'#796649',2);}
  if(p.task){line(14,-25,31,-19,'#526858',3);line(22,-24,33,-21,'#c9c6a5',4);}
  ctx.restore();if(p.id===session?.id){circle(r.x,r.y-73,2.4,'#f7ecd1');}
  if(playing){ctx.font='9px Arial';const width=ctx.measureText(p.name).width;roundBox(r.x-width/2-7,r.y-93,width+14,17,7,'#f9edcfe8');text(p.name,r.x,r.y-81,9);}
}
function cursor(){const p=me();if(!p||p.inside||!mouse.active)return;const x=keys.aimX,y=keys.aimY,valid=Math.hypot(x-p.x,y-(p.y-25))<145,c=valid?'#f1d084':'#c67154';ctx.strokeStyle=c;ctx.lineWidth=2;ctx.setLineDash([3,3]);ctx.beginPath();ctx.arc(p.x,p.y-25,145,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);if(p.tool==='dig'||p.tool==='fill'){ctx.beginPath();ctx.arc(x,y,14,0,Math.PI*2);ctx.stroke();circle(x,y,14,valid?'#f1d08433':'#c6715433');}else{ctx.beginPath();ctx.arc(x,y,17,0,Math.PI*2);ctx.stroke();}line(p.x,p.y-27,x,y,c+'55',1);}
function minimap(){if(!playing)return;const mw=Math.min(400,w*.3),mh=54,x=w-mw-40,y=h-120;rect(x-12,y-8,mw+24,mh+35,'#f4eacecc');const pts=[[x,y+mh]];for(let i=0;i<=100;i++){const wx=i/100*WORLD.width;pts.push([x+i/100*mw,y+(initialSurface(wx)-350)/600*mh]);}pts.push([x+mw,y+mh]);poly(pts,'#9aab86');circle(x+state.vehicle.x/WORLD.width*mw,y+(state.vehicle.y-350)/600*mh,4,'#b96d47');for(const p of state.players)if(!p.inside)circle(x+p.x/WORLD.width*mw,y+(p.y-350)/600*mh,3,colors[p.slot]);text('THE RIDGE ROAD / SCROLL TO ZOOM',x+mw/2,y+mh+16,7,'#677963');}
function frame(now){const dt=Math.min(.1,(now-lastFrame)/1000);lastFrame=now;const t=now/1000,sc=scale();
  const focus=playing?(me()||state.vehicle):{x:state.vehicle.x,y:state.vehicle.y+80};let tx=focus.x-w/sc*(playing?.46:.72),ty=focus.y-h/sc*(playing?.58:.68);camX+=(tx-camX)*Math.min(1,dt*4);camY+=(ty-camY)*Math.min(1,dt*4);
  renderPose.x+=(state.vehicle.x-renderPose.x)*Math.min(1,dt*15);renderPose.y+=(state.vehicle.y-renderPose.y)*Math.min(1,dt*15);let da=Math.atan2(Math.sin(state.vehicle.angle-renderPose.angle),Math.cos(state.vehicle.angle-renderPose.angle));renderPose.angle+=da*Math.min(1,dt*15);
  for(const p of state.players){let r=renderPeople.get(p.id);if(!r){r={x:p.x,y:p.y};renderPeople.set(p.id,r);}const walk=p.inside?(p.localX-(r.localX??p.localX)):p.vx; r.walking=Math.abs(walk)>.1;if(r.walking)r.face=walk>0?1:-1;r.localX=p.localX;r.x+=(p.x-r.x)*Math.min(1,dt*18);r.y+=(p.y-r.y)*Math.min(1,dt*18);}
  background(t);ctx.save();ctx.scale(sc,sc);ctx.translate(-camX,-camY);worldScene(t);vehicle(t);for(const p of state.players)person(p,t);cursor();ctx.restore();minimap();
  $('toast').classList.toggle('show',now<toastUntil);if(playing){if(mouse.active){keys.aimX=camX+mouse.x/sc;keys.aimY=camY+mouse.y/sc;}if(now-lastSent>100)sendInput();}
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
