// Fixed-step, server-authoritative position-based vehicle physics.
export const WORLD={width:4480,height:1280,cell:20,cols:224,rows:64,camp:4170};
export const TOOLS=['dig','fill','cable','saw','timber'];
export const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
const hypot=Math.hypot,G=760,H=1/120;
const profile=[[0,740],[620,740],[900,700],[1110,495],[1350,440],[1520,480],[1730,650],[1840,790],[1950,870],[2090,690],[2280,570],[2460,520],[2660,650],[2850,730],[2990,670],[3130,400],[3370,370],[3570,470],[3820,610],[4080,620],[4480,620]];
export function initialSurface(x){for(let i=1;i<profile.length;i++)if(x<=profile[i][0]){const [a,y]=profile[i-1],[b,z]=profile[i];return y+(z-y)*(x-a)/(b-a);}return 620;}
export function tile(s,c,r){if(c<0||c>=WORLD.cols||r>=WORLD.rows)return 2;if(r<0)return 0;return Number(s.terrain[r*WORLD.cols+c]);}
export function solid(s,x,y){return tile(s,Math.floor(x/20),Math.floor(y/20))>0;}
export function surface(s,x){for(let r=0;r<WORLD.rows;r++)if(tile(s,Math.floor(x/20),r))return r*20;return WORLD.height;}
function particle(x,y,r=10,m=1){return {x,y,ox:x,oy:y,r,inv:1/m,ground:false,nx:0,ny:-1};}
function makeVehicle(x,y){return {x,y,angle:0,speed:0,brake:true,points:[particle(x-116,y-65,9,2),particle(x+116,y-65,9,2),particle(x+116,y+48,9,2),particle(x-116,y+48,9,2),particle(x-86,y+81,36),particle(x+86,y+81,36)],grounded:0,slip:0};}
export function createWorld(){
  const s={version:2,tick:0,terrain:[],terrainVersion:0,vehicle:makeVehicle(370,622),players:[],trees:[],logs:[],anchors:[],cable:null,soil:45,checkpoint:370,won:false,dog:false,lastEvent:'Survey the slope. Shape a route. Bring your home along.',events:[],time:0};
  for(let r=0;r<WORLD.rows;r++)for(let c=0;c<WORLD.cols;c++){const top=initialSurface(c*20+10);s.terrain.push(r*20>=top?(r*20>top+220?2:1):0);}
  for(const [i,x] of [760,1370,2250,2730,3380,3870].entries())s.trees.push({id:'tree'+i,x,y:surface(s,x),height:140+(i%3)*23,cut:0});
  for(const [i,x] of [580,1440,2410,3490,3970].entries())s.anchors.push({id:'rock'+i,x,y:surface(s,x)-18});
  for(let i=0;i<2;i++)s.logs.push({id:'log'+i,a:particle(535+i*45,701-i*24,11,1.2),b:particle(675+i*45,689-i*24,11,1.2),length:140,heldBy:null});
  return s;
}
export function addPlayer(s,id,name){const p={id,name:String(name||'Traveler').trim().slice(0,18)||'Traveler',slot:s.players.length,x:s.vehicle.x,y:s.vehicle.y+40,localX:0,inside:true,station:null,connected:true,vx:0,vy:0,input:{},lastInput:0,tool:'dig',aimX:0,aimY:0,cooldown:0,held:null,heldAngle:0,ground:false};s.players.push(p);return p;}
function announce(s,text){s.lastEvent=text;s.events.push({tick:s.tick,text});s.events=s.events.slice(-12);}
export function pose(v,lx,ly){const co=Math.cos(v.angle),si=Math.sin(v.angle);return {x:v.x+lx*co-ly*si,y:v.y+lx*si+ly*co};}
export function context(s,p){
  if(p.station)return {kind:'release',label:'Leave '+p.station};
  if(p.inside){if(p.localX>58)return {kind:'driver',label:'Take the wheel'};if(p.localX<-94)return {kind:'exit',label:'Step outside'};if(Math.abs(p.localX+51)<34)return {kind:'winch',label:'Operate winch'};return null;}
  if(p.held)return {kind:'drop',label:'Set down timber (Q / R to rotate)'};
  if(hypot(p.x-s.vehicle.x,p.y-s.vehicle.y)<225)return {kind:'board',label:'Climb aboard'};
  if(!s.dog&&hypot(p.x-2510,p.y-surface(s,2510))<80)return {kind:'dog',label:'Befriend Moss'};
  return null;
}
export function interact(s,p){if(!p.connected)return;const c=context(s,p);if(!c)return;
  if(c.kind==='release'){p.station=null;return;}
  if(c.kind==='driver'||c.kind==='winch'){if(!s.players.some(q=>q!==p&&q.connected&&q.station===c.kind)){p.station=c.kind;p.localX=c.kind==='driver'?90:-51;}return;}
  if(c.kind==='exit'){const at=pose(s.vehicle,-150,20);p.inside=false;p.x=at.x;p.y=at.y;p.vx=p.vy=0;return;}
  if(c.kind==='board'){p.inside=true;p.localX=-88;p.vx=p.vy=0;return;}
  if(c.kind==='drop'){drop(s,p);return;}
  if(c.kind==='dog'){s.dog=true;announce(s,'Moss has found his people. There is room by the stove.');}
}
function drop(s,p){const log=s.logs.find(l=>l.id===p.held);if(log){log.heldBy=null;for(const n of [log.a,log.b]){n.ox=n.x;n.oy=n.y;}}p.held=null;}
function reachable(s,p,x,y,limit=145){if(!Number.isFinite(x)||!Number.isFinite(y)||hypot(x-p.x,y-(p.y-25))>limit)return false;
  const d=hypot(x-p.x,y-(p.y-25));for(let t=12;t<d-22;t+=10)if(solid(s,p.x+(x-p.x)*t/d,p.y-25+(y-p.y+25)*t/d))return false;return true;
}
export function toolAction(s,p,action={}){
  if(!p.connected)return false;
  if(action.menu){
    const menu=targetMenu(s,p,Number(action.x),Number(action.y));
    const option=menu.actions.find(a=>a.id===action.menu&&!a.disabled);if(!option)return false;p.task=null;
    if(option.id==='right'){recover(s,true);return true;}
    if(option.id==='board'){p.inside=true;p.station=null;p.localX=-88;p.input={};return true;}
    if(option.id==='exit'){p.station=null;p.localX=-107;interact(s,p);return true;}
    if(option.id==='driver'||option.id==='winch'){p.station=option.id;p.localX=option.id==='driver'?90:-51;p.input={};return true;}
    if(option.id==='release'){p.station=null;p.input={};return true;}
    if(option.id==='drop'){drop(s,p);return true;}
    if(option.id==='rotate-left'||option.id==='rotate-right'){p.heldAngle+=(option.id==='rotate-left'?-1:1)*Math.PI/12;return true;}
    if(option.id==='dog'){s.dog=true;announce(s,'Moss has found his people. There is room by the stove.');return true;}
    p.tool=option.tool;p.cooldown=0;
    const result=toolAction(s,p,{x:option.x,y:option.y});
    if(result&&option.tool==='saw')p.task={x:option.x,y:option.y};
    return result;
  }
  if(action.select&&TOOLS.includes(action.select)){p.tool=action.select;p.task=null;return true;}
  if(Number.isFinite(action.rotate)&&action.rotate&&p.held){p.heldAngle+=clamp(action.rotate,-1,1)*Math.PI/12;return true;}
  if(action.cancel){p.task=null;return true;}
  if(action.recover){recover(s,action.near===true);return true;}
  if(p.inside||p.cooldown>0)return false;
  const x=Number(action.x),y=Number(action.y);if(!reachable(s,p,x,y))return false;
  p.aimX=x;p.aimY=y;p.cooldown=.16;
  if(p.tool==='dig'||p.tool==='fill'){
    const c=Math.floor(x/20),r=Math.floor(y/20),i=r*WORLD.cols+c;if(c<1||c>=WORLD.cols-1||r<1||r>=WORLD.rows-1)return false;
    if(p.tool==='dig'&&tile(s,c,r)===1){s.terrain[i]=0;s.soil++;s.terrainVersion++;return true;}
    if(p.tool==='fill'&&tile(s,c,r)===0&&s.soil>0){
      if(![[c-1,r],[c+1,r],[c,r-1],[c,r+1]].some(([a,b])=>tile(s,a,b)))return false;
      const cx=c*20+10,cy=r*20+10;
      if(s.players.some(q=>!q.inside&&Math.abs(q.x-cx)<22&&cy>q.y-55&&cy<q.y+10))return false;
      if(s.vehicle.points.some(q=>hypot(q.x-cx,q.y-cy)<q.r+15))return false;
      const dx=cx-s.vehicle.x,dy=cy-s.vehicle.y,co=Math.cos(s.vehicle.angle),si=Math.sin(s.vehicle.angle);
      if(Math.abs(dx*co+dy*si)<132&&dy*co-dx*si>-80&&dy*co-dx*si<62)return false;
      if(s.logs.some(l=>distanceSegment(cx,cy,l.a,l.b).d<24))return false;
      s.terrain[i]=1;s.soil--;s.terrainVersion++;return true;
    }return false;
  }
  if(p.tool==='cable'){
    const candidates=[...s.anchors,...s.trees.filter(t=>t.cut<100).map(t=>({...t,y:t.y-75}))];const target=candidates.find(a=>hypot(a.x-x,a.y-y)<55);if(!target)return false;
    if(s.cable?.id===target.id){s.cable=null;announce(s,'Cable released.');return true;}
    const hook=s.vehicle.points[1],distance=hypot(target.x-hook.x,target.y-hook.y);
    if(distance>720){announce(s,'Cable cannot reach. Bring the house closer.');return false;}
    s.cable={id:target.id,x:target.x,y:target.y,length:distance+8,load:0};announce(s,'Cable attached. SPACE reels in; S pays out at the winch.');return true;
  }
  if(p.tool==='saw'){
    const tree=s.trees.find(t=>t.cut<100&&Math.abs(t.x-x)<40&&y>t.y-t.height&&y<t.y+15);if(!tree)return false;tree.cut+=8;
    if(tree.cut>=100){tree.cut=100;if(s.cable?.id===tree.id)s.cable=null;s.logs.push({id:'timber'+tree.id,a:particle(tree.x+10,tree.y-12,12,1.5),b:particle(tree.x+55,tree.y-tree.height+18,12,1.5),length:hypot(45,tree.height-30),heldBy:null});announce(s,'Tree felled. Use timber mode to carry and place the trunk.');}return true;
  }
  if(p.tool==='timber'){
    if(p.held){drop(s,p);return true;}
    const log=s.logs.find(l=>!l.heldBy&&distanceSegment(x,y,l.a,l.b).d<35);if(log){log.heldBy=p.id;p.held=log.id;p.heldAngle=Math.atan2(log.b.y-log.a.y,log.b.x-log.a.x);return true;}
  }return false;
}
function safeRecovery(s,preferred){
  for(const center of [preferred,s.checkpoint,370])for(let radius=0;radius<=520;radius+=40)for(const sign of radius?[1,-1]:[1]){
    const x=clamp(center+radius*sign,160,WORLD.width-160),heights=[];for(let d=-135;d<=135;d+=15)heights.push(surface(s,x+d));
    if(Math.max(...heights)-Math.min(...heights)>20)continue;
    if(s.trees.some(t=>t.cut<100&&Math.abs(t.x-x)<150))continue;
    const y=Math.min(...heights)-125;
    if(s.logs.some(l=>!l.heldBy&&Math.max(l.a.x,l.b.x)>x-145&&Math.min(l.a.x,l.b.x)<x+145&&Math.min(l.a.y,l.b.y)<y+130&&Math.max(l.a.y,l.b.y)>y-90))continue;
    return makeVehicle(x,y);
  }
  // Last-resort rescue above the highest terrain across the whole footprint.
  const x=370;let y=1280;for(let d=-140;d<=140;d+=20)y=Math.min(y,surface(s,x+d));return makeVehicle(x,y-180);
}
function recover(s,near=false){s.vehicle=safeRecovery(s,near?s.vehicle.x:s.checkpoint);s.cable=null;for(const p of s.players){drop(s,p);p.inside=true;p.station=null;p.localX=0;p.x=s.vehicle.x;p.y=s.vehicle.y+40;p.vx=p.vy=0;p.input={};p.task=null;}announce(s,near?'House upright on nearby safe ground. Everyone aboard; terrain work preserved.':'Recovered to safe ground. Everyone aboard; terrain work preserved.');}
export function targetMenu(s,p,x,y){
  const menu={title:'Ground',actions:[]};if(!p||!Number.isFinite(x)||!Number.isFinite(y))return menu;
  const add=(id,label,extra={})=>menu.actions.push({id,label,...extra});
  const dx=x-s.vehicle.x,dy=y-s.vehicle.y,co=Math.cos(s.vehicle.angle),si=Math.sin(s.vehicle.angle),lx=dx*co+dy*si,ly=dy*co-dx*si;
  if(Math.abs(lx)<145&&ly>-120&&ly<125){
    menu.title='Our home';
    if(p.inside){for(const id of ['driver','winch'])if(p.station!==id)add(id,id==='driver'?'Drive':'Use winch',{disabled:s.players.some(q=>q!==p&&q.connected&&q.station===id),reason:'Your partner is using it'});if(p.station)add('release','Leave station');add('exit','Step outside');}
    else add('board','Climb aboard',{disabled:hypot(p.x-s.vehicle.x,p.y-s.vehicle.y)>225,reason:'Walk closer to the house'});
    add('right','Right the house');return menu;
  }
  if(p.held){menu.title='Carried timber';add('drop','Set down');add('rotate-left','Rotate left');add('rotate-right','Rotate right');return menu;}
  const tree=s.trees.find(t=>t.cut<100&&Math.abs(t.x-x)<45&&y>t.y-t.height-15&&y<t.y+20);
  const rock=s.anchors.find(a=>hypot(a.x-x,a.y-y)<35);
  const log=s.logs.find(l=>distanceSegment(x,y,l.a,l.b).d<24);
  const permission=(tx,ty)=>({disabled:p.inside||!reachable(s,p,tx,ty),reason:p.inside?'Step outside first':'Walk closer to reach this'});
  if(tree||rock){const a=tree?{id:tree.id,x:tree.x,y:tree.y-75}:rock;menu.title=tree?'Pine tree':'Rock anchor';add('cable',s.cable?.id===a.id?'Release cable':'Attach cable',{tool:'cable',x:a.x,y:a.y,...permission(a.x,a.y)});if(tree)add('saw','Fell tree',{tool:'saw',x:tree.x,y:tree.y-30,...permission(tree.x,tree.y-30)});return menu;}
  if(log){menu.title='Timber';add('timber',log.heldBy?'Being carried':'Pick up',{tool:'timber',x,y,...permission(x,y),...(log.heldBy?{disabled:true,reason:'Your partner is carrying this'}:{})});return menu;}
  if(!s.dog&&hypot(x-2510,y-(surface(s,2510)-15))<35){menu.title='Moss';add('dog','Say hello',permission(2510,surface(s,2510)-15));return menu;}
  const material=tile(s,Math.floor(x/20),Math.floor(y/20));menu.title=material===2?'Bedrock':material===1?'Soil':'Build a ramp';
  if(material===1)add('dig','Dig',{tool:'dig',x,y,...permission(x,y)});
  if(material===0)add('fill','Place soil',{tool:'fill',x,y,...permission(x,y),...(s.soil<1?{disabled:true,reason:'Dig some soil first'}:{})});
  return menu;
}
function integrate(p,dt,ax=0,ay=G){const dx=clamp((p.x-p.ox)*.999,-5,5),dy=clamp((p.y-p.oy)*.999,-7,7);p.ox=p.x;p.oy=p.y;p.x+=dx+ax*dt*dt;p.y+=dy+ay*dt*dt;p.ground=false;}
function distance(a,b,rest,stiff=1){const dx=b.x-a.x,dy=b.y-a.y,d=hypot(dx,dy)||1,err=(d-rest)/d*stiff,w=a.inv+b.inv;const cx=dx*err,cy=dy*err;a.x+=cx*a.inv/w;a.y+=cy*a.inv/w;b.x-=cx*b.inv/w;b.y-=cy*b.inv/w;}
function push(p,nx,ny,depth,friction=0){p.x+=nx*depth;p.y+=ny*depth;let vx=p.x-p.ox,vy=p.y-p.oy;const inward=vx*nx+vy*ny;if(inward<0){vx-=nx*inward;vy-=ny*inward;}const tang=vx*(-ny)+vy*nx;vx-=(-ny)*tang*friction;vy-=nx*tang*friction;p.ox=p.x-vx;p.oy=p.y-vy;if(ny<-.25){if(!p.ground||Math.abs(nx)>Math.abs(p.nx)){p.nx=nx;p.ny=ny;}p.ground=true;}}
function collideTerrain(s,p,friction=.02){
  for(let r=Math.floor((p.y-p.r)/20);r<=Math.floor((p.y+p.r)/20);r++)for(let c=Math.floor((p.x-p.r)/20);c<=Math.floor((p.x+p.r)/20);c++){
    if(!tile(s,c,r))continue;const l=c*20,t=r*20,qx=clamp(p.x,l,l+20),qy=clamp(p.y,t,t+20),dx=p.x-qx,dy=p.y-qy,d=hypot(dx,dy);
    if(d>0&&d<p.r)push(p,dx/d,dy/d,p.r-d,friction);
    else if(d===0){const choices=[[p.x-l,-1,0],[l+20-p.x,1,0],[p.y-t,0,-1],[t+20-p.y,0,1]].sort((a,b)=>a[0]-b[0]);const [dist,nx,ny]=choices[0];push(p,nx,ny,p.r+dist,friction);}
  }
}
export function distanceSegment(x,y,a,b){const dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy||1),0,1);return {d:hypot(x-a.x-t*dx,y-a.y-t*dy),x:a.x+t*dx,y:a.y+t*dy,t};}
function collideSegment(p,a,b,r,dynamic=false){const q=distanceSegment(p.x,p.y,a,b),sum=p.r+r;if(q.d>=sum)return;let nx=(p.x-q.x)/(q.d||1),ny=(p.y-q.y)/(q.d||1);if(!q.d){nx=0;ny=-1;}const depth=sum-q.d;if(dynamic){push(p,nx,ny,depth*.65,.006);a.x-=nx*depth*.35*(1-q.t);a.y-=ny*depth*.35*(1-q.t);b.x-=nx*depth*.35*q.t;b.y-=ny*depth*.35*q.t;}else push(p,nx,ny,depth,.02);}
function bodyPose(v){const n=v.points;v.x=(n[0].x+n[1].x+n[2].x+n[3].x)/4;v.y=(n[0].y+n[1].y+n[2].y+n[3].y)/4+8.5;v.angle=Math.atan2(n[1].y-n[0].y,n[1].x-n[0].x);}
function frameConstraints(v){const n=v.points;for(const [a,b,len] of [[0,1,232],[1,2,113],[2,3,232],[3,0,113],[0,2,hypot(232,113)],[1,3,hypot(232,113)]])distance(n[a],n[b],len);}
function suspension(v,index,lx){const wheel=v.points[index],target=pose(v,lx,81),co=Math.cos(v.angle),si=Math.sin(v.angle),dx=wheel.x-target.x,dy=wheel.y-target.y,lateral=dx*co+dy*si,vertical=-dx*si+dy*co;const spring=clamp(vertical,-22,26)*.085+(vertical-clamp(vertical,-22,26))*.7,cx=lateral*.65*co-spring*si,cy=lateral*.65*si+spring*co;wheel.x-=cx*.8;wheel.y-=cy*.8;for(const i of index===4?[0,3]:[1,2]){v.points[i].x+=cx*.1;v.points[i].y+=cy*.1;}}
function edgeContacts(s,a,b){const len=hypot(b.x-a.x,b.y-a.y),count=Math.ceil(len/14);for(let i=1;i<count;i++){const t=i/count,x=a.x*(1-t)+b.x*t,y=a.y*(1-t)+b.y*t,sample=particle(x,y,7);sample.ox=a.ox*(1-t)+b.ox*t;sample.oy=a.oy*(1-t)+b.oy*t;collideTerrain(s,sample,.35);const dx=sample.x-x,dy=sample.y-y,w=(1-t)**2+t*t;a.x+=dx*(1-t)/w;a.y+=dy*(1-t)/w;b.x+=dx*t/w;b.y+=dy*t/w;}}
function physics(s,dt,throttle,brake,reel,payout){const v=s.vehicle;
  for(const log of s.logs){if(log.heldBy)continue;integrate(log.a,dt);integrate(log.b,dt);}
  for(let i=0;i<v.points.length;i++){const p=v.points[i];let ax=0,ay=G;if(i>=4&&p.ground){const drive=throttle*5200;ax=-p.ny*drive;ay+=p.nx*drive;}
    if(i===1&&s.cable){const cable=s.cable,dx=cable.x-p.x,dy=cable.y-p.y,d=hypot(dx,dy)||1;if(reel)cable.length=Math.max(45,cable.length-46*dt);if(payout)cable.length=Math.min(740,cable.length+70*dt);const force=clamp((d-cable.length)*130,0,10000);ax+=dx/d*force;ay+=dy/d*force;cable.load=force/10000*100;}
    integrate(p,dt,ax,ay);
  }
  for(let k=0;k<7;k++){
    frameConstraints(v);bodyPose(v);suspension(v,4,-86);suspension(v,5,86);
    for(const log of s.logs){if(log.heldBy)continue;distance(log.a,log.b,log.length);collideTerrain(s,log.a,.12);collideTerrain(s,log.b,.12);edgeContacts(s,log.a,log.b);}
    for(let i=0;i<v.points.length;i++){const p=v.points[i];collideTerrain(s,p,i>=4?(brake?.18:.002):.28);for(const tree of s.trees)if(tree.cut<100)collideSegment(p,{x:tree.x,y:tree.y},{x:tree.x,y:tree.y-tree.height},9);for(const log of s.logs)if(!log.heldBy)collideSegment(p,log.a,log.b,11,true);}
    for(const [a,b] of [[0,1],[1,2],[2,3],[3,0]])edgeContacts(s,v.points[a],v.points[b]);
  }
  bodyPose(v);v.grounded=v.points.slice(4).filter(p=>p.ground).length;v.slip=throttle&&v.grounded<2?1:0;
}
function playerMove(s,p,dt){const move=(p.input.right?1:0)-(p.input.left?1:0);
  if(p.inside){if(!p.station)p.localX=clamp(p.localX+move*150*dt,-107,100);const q=pose(s.vehicle,p.localX,40);p.x=q.x;p.y=q.y;p.vy=0;return;}
  if(p.input.jump&&p.ground&&!p.jumped){p.vy=-355;p.jumped=true;}if(!p.input.jump)p.jumped=false;
  p.vx=move*(p.held?90:165);p.vy=clamp(p.vy+G*dt,-400,400);let nx=clamp(p.x+p.vx*dt,18,WORLD.width-18);
  const blocked=(xx,yy)=>[-9,9].some(dx=>[-9,-28,-44].some(dy=>solid(s,xx+dx,yy+dy)));
  if(!blocked(nx,p.y))p.x=nx;else if(p.ground&&!blocked(nx,p.y-20)){p.x=nx;p.y-=20;}
  let ny=p.y+p.vy*dt;p.ground=false;
  if(p.vy>=0){for(const dx of [-8,8])if(solid(s,p.x+dx,ny)){ny=Math.floor(ny/20)*20;p.vy=0;p.ground=true;}}
  else if(solid(s,p.x-8,ny-46)||solid(s,p.x+8,ny-46)){ny=(Math.floor((ny-46)/20)+1)*20+46;p.vy=0;}
  for(const l of s.logs)if(!l.heldBy&&p.vy>=0){const q=distanceSegment(p.x,ny,l.a,l.b);if(q.d<16&&ny<q.y+8&&p.y<=q.y){ny=q.y-12;p.vy=0;p.ground=true;}}
  p.y=ny;if(p.y>WORLD.height-35){p.x=s.vehicle.x-150;p.y=surface(s,p.x)-5;p.vy=0;}
  if(p.held){const l=s.logs.find(l=>l.id===p.held);if(l){const mx=p.x+Math.cos(p.heldAngle)*12,my=p.y-75,ax=mx-Math.cos(p.heldAngle)*l.length/2,ay=my-Math.sin(p.heldAngle)*l.length/2,bx=mx+Math.cos(p.heldAngle)*l.length/2,by=my+Math.sin(p.heldAngle)*l.length/2;let clear=true;for(let t=0;t<=1;t+=.1)if(solid(s,ax+(bx-ax)*t,ay+(by-ay)*t))clear=false;if(clear){Object.assign(l.a,{x:ax,y:ay,ox:ax,oy:ay});Object.assign(l.b,{x:bx,y:by,ox:bx,oy:by});}}}
}
export function step(s,dt=.05){s.tick++;s.time+=dt;const v=s.vehicle,oldX=v.x,driver=s.players.find(p=>p.connected&&p.station==='driver'),wincher=s.players.find(p=>p.connected&&p.station==='winch'),throttle=driver?((driver.input.right?1:0)-(driver.input.left?1:0)):0,solo=s.players.filter(p=>p.connected).length===1,reel=!!wincher?.input.jump||(solo&&!!driver?.input.jump),payout=!!wincher?.input.down||(solo&&!!driver?.input.down);
  v.brake=!driver||!!driver.input.brake;const count=Math.max(1,Math.round(dt/H)),h=dt/count;for(let i=0;i<count;i++){physics(s,h,throttle,v.brake,reel,payout);for(const p of s.players)if(p.connected)playerMove(s,p,h);}
  v.speed=(v.x-oldX)/dt;for(const p of s.players){p.cooldown=Math.max(0,p.cooldown-dt);if(p.input.work)toolAction(s,p,{x:p.input.aimX,y:p.input.aimY});if(p.task){if(p.inside||p.input.left||p.input.right||!p.connected||!reachable(s,p,p.task.x,p.task.y)||!s.trees.some(t=>t.cut<100&&Math.abs(t.x-p.task.x)<40))p.task=null;else if(p.cooldown===0){p.tool='saw';toolAction(s,p,p.task);}}if(!p.connected&&p.held)drop(s,p);}
  if(v.grounded===2&&Math.abs(v.angle)<.10&&Math.abs(v.speed)<12&&v.x>s.checkpoint+200)s.checkpoint=v.x;
  if(v.x>WORLD.camp&&!s.won&&s.players.filter(p=>p.connected).every(p=>p.inside)){s.won=true;announce(s,'Stillwater. You made this route your own. Park up and put the kettle on.');}
}
export function objective(s){if(s.won)return 'Park at Stillwater. The kettle is on.';if(s.vehicle.x<900)return 'Survey the first climb. Prepare your approach.';if(s.vehicle.x<1550)return 'Find traction on the ridge. Shape it or winch it.';if(s.vehicle.x<2400)return 'Pick a line through the gully.';if(s.vehicle.x<3500)return 'The high pass: cut a route or climb over.';return 'Bring your home down to Stillwater.';}
export function snapshot(s,withTerrain=true){const {terrain,...rest}=s;return {...rest,...(withTerrain?{terrain:terrain.join('')}:{}),players:s.players.map(({input,lastInput,cooldown,...p})=>p),objective:objective(s)};}
