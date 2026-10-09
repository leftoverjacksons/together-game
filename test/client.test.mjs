import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as game from '../shared/game.mjs';

// Exercises actual client startup, room join, streamed state and draw calls without
// a browser dependency. This is a runtime smoke check, not visual browser QA.
test('client starts, joins a room, merges terrain updates, and renders both players',async()=>{
  const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const source=(await readFile(new URL('../public/overland.js',import.meta.url),'utf8')).replace(/^import[^\n]+\n/,'');
  const draw=new Proxy({measureText:t=>({width:t.length*5}),createLinearGradient:()=>({addColorStop(){}})},{get:(o,k)=>k in o?o[k]:()=>{}});
  const element=()=>({value:'',dataset:{},style:{},classList:{add(){},toggle(){}},append(){},replaceChildren(){},setAttribute(){},addEventListener(){},showModal(){},close(){},querySelector(){return {textContent:''};},getContext:()=>draw});
  const elements=new Map([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],element()]));elements.get('name').value='Tester';
  const s=game.createWorld();game.addPlayer(s,'a','Tester');game.addPlayer(s,'b','Partner');
  let eventSource,frames=0;
  const sandbox={...game,console,innerWidth:1440,innerHeight:900,devicePixelRatio:1,performance:{now:()=>1000},URLSearchParams,location:{search:'',origin:'http://localhost:3000',hostname:'localhost'},history:{replaceState(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},navigator:{},addEventListener(){},requestAnimationFrame(){frames++;},document:{getElementById:id=>{assert(elements.has(id),'missing HTML element '+id);return elements.get(id);},createElement:element,createTextNode:t=>t,body:element(),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){}},fetch:async()=>({ok:true,json:async()=>({code:'TEST',id:'a',token:'credential',sequence:-1,state:game.snapshot(s)})}),EventSource:class{constructor(){eventSource=this;}close(){}}};
  const context=vm.createContext(sandbox);vm.runInContext(source,context);vm.runInContext('frame(1016)',context);assert(frames>1);
  await vm.runInContext('enter()',context);eventSource.onmessage({data:JSON.stringify(game.snapshot(s))});
  game.step(s);eventSource.onmessage({data:JSON.stringify(game.snapshot(s,false))});vm.runInContext('frame(1066)',context);
  assert.equal(vm.runInContext('state.terrain.length',context),game.WORLD.cols*game.WORLD.rows);assert.equal(vm.runInContext('state.players.length',context),2);
  assert.match(elements.get('connection').textContent,/2\/2/);
});
