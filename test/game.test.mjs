import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,addPlayer,interact,step,WORLD} from '../shared/game.mjs';
import {createGameServer} from '../server.mjs';

function at(p,x,inside=false){p.x=x;p.y=inside?450:520;p.inside=inside;p.station=null;p.input={};}
test('full route: salvage, bridge, both stations, tree, pet, campsite',()=>{
  const s=createWorld(),a=addPlayer(s,'a','A'),b=addPlayer(s,'b','B');
  // Vehicle cannot bypass the broken bridge.
  a.station='driver';a.input={right:true};for(let i=0;i<300;i++)step(s);
  assert.equal(s.vehicle.x,WORLD.riverStart-145);
  for(const x of [900,900,1300]){at(b,x);interact(s,b);assert.equal(b.carrying,true);at(b,WORLD.bridge);interact(s,b);}
  assert.equal(s.bridge,3);assert.equal(b.carrying,false);
  step(s);assert.equal(s.vehicle.x,WORLD.riverStart-145,'anchor still required');
  at(b,WORLD.anchor);interact(s,b);assert.equal(s.anchored,true);
  // Without the second operator cable tension drops and progress stops.
  for(let i=0;i<130;i++)step(s);
  assert(s.tension<15);const stopped=s.vehicle.x;step(s);assert.equal(s.vehicle.x,stopped);
  at(b,s.vehicle.x-65,true);interact(s,b);b.input={jump:true};
  assert.equal(b.station,'winch');for(let i=0;i<400;i++)step(s);
  assert(s.vehicle.x>WORLD.riverEnd);
  assert.equal(s.vehicle.x,WORLD.tree-170);
  at(b,2340);interact(s,b);assert(s.dog);
  at(b,WORLD.tree);interact(s,b);assert(s.treeCable);
  at(b,s.vehicle.x-65,true);interact(s,b);b.input={jump:true};for(let i=0;i<120;i++)step(s);
  assert.equal(s.treeProgress,100);
  for(let i=0;i<300;i++)step(s);
  assert.equal(s.won,true);
});
test('stations are exclusive, carrying is conserved, and wet landings recover',()=>{
  const s=createWorld(),a=addPlayer(s,'a','A'),b=addPlayer(s,'b','B');
  at(a,s.vehicle.x+110,true);at(b,a.x,true);interact(s,a);interact(s,b);
  assert.equal(a.station,'driver');assert.equal(b.station,null);
  at(b,900);interact(s,b);interact(s,b);assert.equal(s.planks[0].count,1);
  at(b,1710);b.y=620;b.vy=200;step(s);assert.equal(b.x,1580);assert(b.carrying);
});
test('solo assistance works and completion waits for everyone aboard',()=>{
  const s=createWorld(),a=addPlayer(s,'a','A');s.bridge=3;s.anchored=true;s.treeProgress=100;s.vehicle.x=1600;
  at(a,1710,true);a.station='driver';a.input={right:true};s.tension=0;
  for(let i=0;i<100;i++)step(s);assert(s.vehicle.x>1600);assert(s.tension>90);
  const b=addPlayer(s,'b','B');at(b,3500);s.vehicle.x=3640;step(s);assert(!s.won);
  at(b,s.vehicle.x-120,true);step(s);assert(s.won);
});
test('two clients share authoritative events; credentials, room limits, reconnect and input ordering',async t=>{
  const {server,rooms}=createGameServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,b)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,data:await r.json()};};
  const a=(await post('/api/rooms',{name:'A'})).data;
  const b=(await post('/api/join',{name:'B',code:a.code})).data;
  assert.equal((await post('/api/join',{code:a.code,name:'C'})).status,409);
  assert.equal((await post('/api/input',{code:a.code,token:'wrong'})).status,403);
  const controllerA=new AbortController(),controllerB=new AbortController();t.after(()=>{controllerA.abort();controllerB.abort();});
  const eventsA=await fetch(`${base}/api/events?code=${a.code}&token=${a.token}`,{signal:controllerA.signal});
  const eventsB=await fetch(`${base}/api/events?code=${b.code}&token=${b.token}`,{signal:controllerB.signal});
  const ra=eventsA.body.getReader(),rb=eventsB.body.getReader();await ra.read();await rb.read();
  await post('/api/input',{...a,sequence:8,right:true});await post('/api/input',{...a,sequence:7,left:true});
  const room=rooms.get(a.code);assert.equal(room.state.players[0].input.right,true);
  const a1=JSON.parse(new TextDecoder().decode((await ra.read()).value).split('data: ')[1].split('\n\n')[0]);
  const b1=JSON.parse(new TextDecoder().decode((await rb.read()).value).split('data: ')[1].split('\n\n')[0]);
  assert.equal(a1.players.length,2);assert.equal(b1.players.length,2);assert(a1.tick>0);assert(b1.tick>0);
  const resumed=await post('/api/join',{code:a.code,token:a.token});assert.equal(resumed.data.id,a.id);assert.equal(resumed.data.sequence,8);
  assert.equal((await fetch(base+'/../../server.mjs')).status,404);
  const html=await fetch(base);assert.equal(html.status,200);assert.match(await html.text(),/A little home/);
  controllerA.abort();controllerB.abort();
});
