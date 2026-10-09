import test from 'node:test';
import assert from 'node:assert/strict';
import {createGameServer} from '../server.mjs';
test('two live clients receive shared terrain edits and physics, with authorization and reconnects',async t=>{
  const {server,rooms}=createGameServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=async(path,b)=>{const r=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,data:await r.json()};};
  const a=(await post('/api/rooms',{name:'A'})).data,b=(await post('/api/join',{name:'B',code:a.code})).data;
  const auth=p=>({code:p.code,token:p.token});
  assert.equal((await post('/api/join',{code:a.code,name:'C'})).status,409);assert.equal((await post('/api/tool',{code:a.code,token:'wrong',action:{recover:true}})).status,403);
  const controllers=[new AbortController(),new AbortController()];t.after(()=>controllers.forEach(c=>c.abort()));
  async function* frames(p,controller){const r=await fetch(`${base}/api/events?code=${p.code}&token=${p.token}`,{signal:controller.signal});const reader=r.body.getReader();let text='';const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)return;text+=decoder.decode(value,{stream:true});let i;while((i=text.indexOf('\n\n'))>=0){const frame=text.slice(0,i);text=text.slice(i+2);if(frame.startsWith('data: '))yield JSON.parse(frame.slice(6));}}}
  const fa=frames(a,controllers[0]),fb=frames(b,controllers[1]);assert((await fa.next()).value.terrain);assert((await fb.next()).value.terrain);
  const room=rooms.get(a.code),p=room.state.players[0];Object.assign(p,{inside:false,x:510,y:740,tool:'dig'});
  const result=await post('/api/tool',{...auth(a),action:{x:550,y:750}});assert.equal(result.status,200);
  for(const stream of [fa,fb]){let got;for(let i=0;i<10;i++){got=(await stream.next()).value;if(got.terrainVersion===1)break;}assert.equal(got.terrainVersion,1);assert.equal(got.terrain[37*224+27],'0');}
  await post('/api/input',{...auth(a),sequence:8,right:true});await post('/api/input',{...auth(a),sequence:7,left:true});assert.equal(p.input.right,true);
  const resume=(await post('/api/join',auth(a))).data;assert.equal(resume.id,a.id);assert.equal(resume.sequence,8);assert.equal(resume.state.terrain[37*224+27],'0');
  for(const url of ['/','/game.js','/shared/game.mjs','/shared/physics.mjs','/style.css'])assert.equal((await fetch(base+url)).status,200);
  assert.equal((await fetch(base+'/server.mjs')).status,404);controllers.forEach(c=>c.abort());
});
