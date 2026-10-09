// Shared contour geometry: the renderer and physics use the same boundary.
// Existing edit cells remain network-compatible; untouched terrain keeps its
// continuous elevation rather than being quantized to the cell lattice.
const C=224,R=64,S=20;
const profile=[[0,740],[620,740],[900,700],[1110,495],[1350,440],[1520,480],[1730,650],[1840,790],[1950,870],[2090,690],[2280,570],[2460,520],[2660,650],[2850,730],[2990,670],[3130,400],[3370,370],[3570,470],[3820,610],[4080,620],[4480,620]];
export function initialSurface(x){for(let i=1;i<profile.length;i++)if(x<=profile[i][0]){const [a,y]=profile[i-1],[b,z]=profile[i];return y+(z-y)*(x-a)/(b-a);}return 620;}
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const arrays=new WeakMap();let stringCache=null;
export function terrainMesh(s){
  const old=typeof s.terrain==='string'?stringCache:arrays.get(s.terrain);
  if(old&&old.source===s.terrain&&old.version===s.terrainVersion)return old;
  const field=new Float32Array(C*R),cells=Array.from({length:(C-1)*(R-1)},()=>[]),polygons=[],segments=[];
  for(let r=0;r<R;r++)for(let c=0;c<C;c++){
    const x=c*S+10,y=r*S+10,base=initialSurface(x),original=r*S>=base,current=Number(s.terrain[r*C+c])>0;
    field[r*C+c]=original===current?clamp((y-base)/S,-1,1):(current?1:-1);
  }
  const vertex=(c,r)=>({x:c*S+10,y:r*S+10,v:field[r*C+c]});
  function triangle(points,bin){
    const polygon=[],crossings=[];
    for(let i=0;i<3;i++){const a=points[i],b=points[(i+1)%3];if(a.v>=0)polygon.push(a);if((a.v>=0)!==(b.v>=0)){const t=a.v/(a.v-b.v),q={x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t};polygon.push(q);crossings.push(q);}}
    if(polygon.length>=3)polygons.push(polygon);
    if(crossings.length===2){const [a,b]=crossings,dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy);if(len<1e-5)return;let nx=dy/len,ny=-dx/len;const inside=points.find(p=>p.v>0);if(inside&&(inside.x-(a.x+b.x)/2)*nx+(inside.y-(a.y+b.y)/2)*ny>0){nx=-nx;ny=-ny;}const edge={a,b,nx,ny};segments.push(edge);bin.push(edge);}
  }
  for(let r=0;r<R-1;r++)for(let c=0;c<C-1;c++){
    const a=vertex(c,r),b=vertex(c+1,r),d=vertex(c,r+1),e=vertex(c+1,r+1),bin=cells[r*(C-1)+c];
    triangle([a,b,e],bin);triangle([a,e,d],bin);
  }
  const mesh={source:s.terrain,version:s.terrainVersion,field,cells,polygons,segments};
  if(typeof s.terrain==='string')stringCache=mesh;else arrays.set(s.terrain,mesh);return mesh;
}
export function density(s,x,y){
  if(x<10||x>4470||y>1270)return 1;if(y<10)return -1;
  const mesh=terrainMesh(s),gx=clamp((x-10)/S,0,C-1.00001),gy=clamp((y-10)/S,0,R-1.00001),c=Math.floor(gx),r=Math.floor(gy),u=gx-c,v=gy-r;
  const a=mesh.field[r*C+c],b=mesh.field[r*C+c+1],d=mesh.field[(r+1)*C+c],e=mesh.field[(r+1)*C+c+1];
  return u>=v?a+(b-a)*u+(e-b)*v:a+(e-d)*u+(d-a)*v;
}
export function terrainContact(s,x,y,radius){
  const mesh=terrainMesh(s),inside=density(s,x,y)>0,range=radius+(inside?50:2);
  let best=null,bestD=Infinity;
  const c0=clamp(Math.floor((x-range-10)/S),0,C-2),c1=clamp(Math.floor((x+range-10)/S),0,C-2),r0=clamp(Math.floor((y-range-10)/S),0,R-2),r1=clamp(Math.floor((y+range-10)/S),0,R-2);
  for(let r=r0;r<=r1;r++)for(let c=c0;c<=c1;c++)for(const edge of mesh.cells[r*(C-1)+c]){
    const {a,b}=edge,dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy),0,1),qx=a.x+t*dx,qy=a.y+t*dy,d=Math.hypot(x-qx,y-qy);
    if(d<bestD){bestD=d;best={...edge,qx,qy,d};}
  }
  if(!best||(!inside&&bestD>=radius))return null;
  if(!inside&&bestD>1e-6){best.nx=(x-best.qx)/bestD;best.ny=(y-best.qy)/bestD;}
  return {nx:best.nx,ny:best.ny,depth:inside?radius+bestD:radius-bestD};
}
export function terrainFloor(s,x,from=0,to=1280){
  const mesh=terrainMesh(s),c=clamp(Math.floor((x-10)/S),0,C-2);let best=Infinity;
  for(let r=clamp(Math.floor((from-10)/S),0,R-2);r<=clamp(Math.floor((to-10)/S),0,R-2);r++)for(const edge of mesh.cells[r*(C-1)+c]){
    const {a,b,ny}=edge;if(ny>=-.05||x<Math.min(a.x,b.x)-.001||x>Math.max(a.x,b.x)+.001||Math.abs(b.x-a.x)<1e-6)continue;
    const y=a.y+(b.y-a.y)*(x-a.x)/(b.x-a.x);if(y>=from-.01&&y<=to+.01)best=Math.min(best,y);
  }return best;
}
