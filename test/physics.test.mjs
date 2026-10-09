import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,addPlayer,step,toolAction,interact,snapshot,surface,solid,WORLD,targetMenu} from '../shared/game.mjs';
const advance=(s,n)=>{for(let i=0;i<n;i++)step(s);};
function driver(s){const p=addPlayer(s,'driver','Driver');p.station='driver';p.localX=90;return p;}
function outside(s,x,y){const p=addPlayer(s,'builder','Builder');Object.assign(p,{inside:false,x,y});return p;}
test('suspended chassis settles, holds parking brake, and stays finite for a minute',()=>{
  const s=createWorld();advance(s,1200);assert(Math.abs(s.vehicle.x-370)<8);assert(Math.abs(s.vehicle.angle)<.05);assert.equal(s.vehicle.grounded,2);
  assert(s.vehicle.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));assert(s.vehicle.points[4].y>s.vehicle.points[3].y);
});
test('traction cannot climb the untouched ridge; an uphill winch can pull the chassis up',()=>{
  const s=createWorld();s.trees=[];s.logs=[];const p=driver(s);p.input={right:true};advance(s,300);
  const before={x:s.vehicle.x,y:s.vehicle.y};assert(before.x>600&&before.x<1100);advance(s,100);assert(Math.abs(s.vehicle.x-before.x)<30);
  const hook=s.vehicle.points[1];s.cable={id:'test',x:1370,y:365,length:Math.hypot(1370-hook.x,365-hook.y),load:0};p.input.jump=true;advance(s,400);
  assert(s.vehicle.x>before.x+250);assert(s.vehicle.y<before.y-120);assert(s.cable.length<300);assert(s.cable.load>=0&&s.cable.load<=100);
});
test('unpowered wheels do not create thrust in mid-air',()=>{
  const a=createWorld(),b=createWorld();for(const s of [a,b]){s.terrain.fill(0);s.logs=[];s.trees=[];driver(s);}
  a.players[0].input={right:true};advance(a,15);advance(b,15);assert(Math.abs(a.vehicle.x-b.vehicle.x)<.01);assert(a.vehicle.y>650);
});
test('soil excavation and replacement conserve shared soil; bedrock and reach are enforced',()=>{
  const s=createWorld(),p=outside(s,510,740),soil=s.soil;assert(solid(s,550,750));
  assert(toolAction(s,p,{x:550,y:750}));assert(!solid(s,550,750));assert.equal(s.soil,soil+1);
  p.cooldown=0;toolAction(s,p,{select:'fill'});assert(toolAction(s,p,{x:550,y:750}));assert.equal(s.soil,soil);
  p.cooldown=0;assert(!toolAction(s,p,{x:4200,y:700}));
  p.tool='dig';p.x=510;p.y=990;p.cooldown=0;assert(!toolAction(s,p,{x:550,y:990}));assert.equal(s.soil,soil);
});
test('terrain supports tunnels rather than only a height map; fill cannot trap players',()=>{
  const s=createWorld();const p=outside(s,1050,610);const c=53,r=29;
  // Prepare an accessible pocket to represent the end of an excavated passage.
  for(let yy=27;yy<32;yy++)for(let xx=50;xx<53;xx++)s.terrain[yy*WORLD.cols+xx]=0;
  p.x=1040;p.y=610;p.cooldown=0;assert(toolAction(s,p,{x:c*20+10,y:r*20+10}));
  assert(solid(s,1070,550),'soil above the cavity remains');assert(!solid(s,1070,590));
  p.tool='fill';p.cooldown=0;p.x=1070;p.y=610;assert(!toolAction(s,p,{x:1070,y:590}));
});
test('felling produces physical timber; occupancy and carrying are exclusive',()=>{
  const s=createWorld(),p=outside(s,710,surface(s,760));p.tool='saw';const tree=s.trees[0];
  for(let i=0;i<13;i++){p.cooldown=0;assert(toolAction(s,p,{x:tree.x,y:tree.y-30}));}
  assert.equal(tree.cut,100);assert.equal(s.logs.length,3);advance(s,25);
  const log=s.logs[0];p.x=(log.a.x+log.b.x)/2;p.y=(log.a.y+log.b.y)/2+30;p.tool='timber';p.cooldown=0;
  assert(toolAction(s,p,{x:p.x,y:p.y-30}));assert.equal(log.heldBy,p.id);
  const q=outside(s,p.x,p.y);q.tool='timber';toolAction(s,q,{x:p.x,y:p.y-30});assert.notEqual(q.held,log.id);assert.equal(log.heldBy,p.id);
  interact(s,p);assert.equal(log.heldBy,null);assert.equal(p.held,null);
});
test('cable attaches only within reach, pays out, detaches, and solo control does not replace a partner',()=>{
  const s=createWorld(),p=outside(s,580,740);p.tool='cable';assert(toolAction(s,p,{x:580,y:722}));assert.equal(s.cable.id,'rock0');
  const d=driver(s);d.input={jump:true};const length=s.cable.length;advance(s,20);assert.equal(s.cable.length,length,'two travelers require a winch operator');
  p.inside=true;p.station='winch';p.input={jump:true};advance(s,20);assert(s.cable.length<length);
  p.input={down:true};advance(s,20);assert(s.cable.length>length-46);
  Object.assign(p,{inside:false,station:null,x:580,y:740,cooldown:0});assert(toolAction(s,p,{x:580,y:722}));assert.equal(s.cable,null);
});
test('recovery preserves earthworks and boards both travelers; snapshot omits terrain unless needed',()=>{
  const s=createWorld(),p=outside(s,510,740);toolAction(s,p,{x:550,y:750});const version=s.terrainVersion;const q=driver(s);p.x=s.vehicle.x;p.y=s.vehicle.y;
  assert(toolAction(s,p,{recover:true}));assert(s.players.every(p=>p.inside));assert.equal(s.terrainVersion,version);assert(!solid(s,550,750));
  assert.equal(snapshot(s).terrain.length,WORLD.cols*WORLD.rows);assert(!('terrain' in snapshot(s,false)));assert(!('input' in snapshot(s).players[0]));
  q.localX=90;interact(s,q);p.localX=90;interact(s,p);assert.equal(q.station,'driver');assert.equal(p.station,null);
});
test('click menus offer object-specific actions and enforce reach and station occupancy',()=>{
  const s=createWorld(),p=driver(s),q=addPlayer(s,'partner','Partner');
  let m=targetMenu(s,q,s.vehicle.x,s.vehicle.y);assert(m.actions.find(a=>a.id==='driver').disabled);
  assert(!toolAction(s,q,{menu:'driver',x:s.vehicle.x,y:s.vehicle.y}));assert.equal(q.station,null);
  assert(toolAction(s,q,{menu:'winch',x:s.vehicle.x,y:s.vehicle.y}));assert.equal(q.station,'winch');
  assert(toolAction(s,q,{menu:'exit',x:s.vehicle.x,y:s.vehicle.y}));assert(!q.inside);
  const tree=s.trees[0];m=targetMenu(s,q,tree.x,tree.y-30);assert.equal(m.title,'Pine tree');assert(m.actions.every(a=>a.disabled));
  q.x=tree.x-30;q.y=tree.y;q.cooldown=0;m=targetMenu(s,q,tree.x,tree.y-30);assert(m.actions.every(a=>!a.disabled));
  assert(toolAction(s,q,{menu:'saw',x:tree.x,y:tree.y-30}));advance(s,65);assert.equal(tree.cut,100);assert(!q.task);
  assert.equal(targetMenu(s,p,NaN,0).actions.length,0);
});
test('rollover rescue works from afar, rights the chassis, stops input and preserves terrain',()=>{
  const s=createWorld(),p=driver(s),q=outside(s,3200,400);s.terrain[37*224+27]=0;s.terrainVersion++;const dirt=s.terrain.join('');
  const v=s.vehicle;for(const n of v.points){n.x=v.x-(n.x-v.x);n.y=v.y-(n.y-v.y);n.ox=n.x;n.oy=n.y;}v.angle=Math.PI;p.input={right:true,jump:true};s.cable={id:'x',x:700,y:400,length:40,load:100};
  assert(toolAction(s,q,{recover:true,near:true}));assert.equal(s.vehicle.angle,0);assert.equal(s.cable,null);assert(s.players.every(p=>p.inside&&!p.station&&!p.input.right));assert.equal(s.terrain.join(''),dirt);
  advance(s,120);assert(Math.abs(s.vehicle.angle)<.1);assert.equal(s.vehicle.grounded,2);
});
