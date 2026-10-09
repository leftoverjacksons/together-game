import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorld,terrainMesh,terrainFloor,terrainContact,density,step,addPlayer,WORLD} from '../shared/game.mjs';

test('gentle hills are continuous at former tile seams and share visual/collision geometry',()=>{
  const s=createWorld(),mesh=terrainMesh(s);assert(mesh.segments.length>100);
  for(let x=650;x<860;x+=20){const a=terrainFloor(s,x-.01),b=terrainFloor(s,x+.01);assert(Math.abs(a-b)<.03,'no 20-unit vertical steps');const y=terrainFloor(s,x);assert(Math.abs(density(s,x,y))<.0001);const contact=terrainContact(s,x,y-20,36);assert(contact);assert(contact.ny<-.8);}
});
test('terrain edit invalidates mesh and opens a rounded cavity without removing its roof',()=>{
  const s=createWorld(),old=terrainMesh(s),c=52,r=29;
  // Carve a 60-unit chamber inside a hill, retaining a thick soil roof.
  for(let yy=r;yy<r+3;yy++)for(let xx=c;xx<c+3;xx++)s.terrain[yy*WORLD.cols+xx]=0;s.terrainVersion++;
  const mesh=terrainMesh(s);assert.notEqual(mesh,old);assert(density(s,1070,610)<0);assert(density(s,1070,550)>0);
  assert(terrainContact(s,1060,591,14),'ceiling is physical');
  const client={...s,terrain:s.terrain.join('')};assert.equal(terrainMesh(client).segments.length,mesh.segments.length);assert.equal(terrainFloor(client,800),terrainFloor(s,800));
});
test('revised motor rolls the gentle approach without launching or rolling over',()=>{
  const s=createWorld();s.trees=[];s.logs=[];const p=addPlayer(s,'a','A');p.station='driver';p.input={right:true};
  let maxSpeed=0,maxPitch=0;for(let i=0;i<90;i++){step(s);maxSpeed=Math.max(maxSpeed,Math.abs(s.vehicle.speed));maxPitch=Math.max(maxPitch,Math.abs(s.vehicle.angle));}
  assert(s.vehicle.x>720,'vehicle crosses the gentle grade');assert(maxSpeed<170,'controlled speed');assert(maxPitch<.5,'no artificial rollover on approach');
});
