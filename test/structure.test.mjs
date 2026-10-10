import test from 'node:test';
import assert from 'node:assert/strict';
import { World, Vec2, Circle, Box } from 'planck';
import { Structure, BOARD } from '../shared/structure.mjs';

// Ground everywhere below y = 0 except a gap between x = 0 and x = gap.
const ground = gap => ({ solidAt: (x, y) => y < 0 && (x < 0 || x > gap) });
const none = () => false;
const setup = (gap = 3) => { const world = new World({ gravity: Vec2(0, -9.81) }); return { world, s: new Structure(world, ground(gap)) }; };
const centreLoad = (s, id, fy) => { const b = s.boards.get(id); const A = s.joints.get(b.a), B = s.joints.get(b.b); return new Map([[id, [{ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2, fx: 0, fy }]]]); };

test('a board must touch the ground or another board', () => {
  const { s } = setup();
  assert.match(s.place(1, 2, 2, 2, none).error, /rest on the ground/);
  assert.ok(s.place(-1, 0, 1, 0.5, none).board);
});

test('an unsupported board is shaky: it stands briefly, then falls', () => {
  const { s } = setup();
  const { board } = s.place(-0.5, 0, 1.5, 1, none);
  assert.deepEqual(s.analyse(), []);
  assert.equal(s.boards.get(board.id).unstable, true);
  let fallen = [];
  for (let k = 0; k < 100 && !fallen.length; k++) fallen = s.analyse(new Map(), 0.1);
  assert.deepEqual(fallen, [board.id]);
  assert.equal(s.boards.size, 0);
  assert.equal(s.debris.size, 1);
});

test('a shaky board falls at once when loaded, and bracing it in time saves it', () => {
  const { s } = setup(3);
  const a = s.place(-0.5, 0, 1.5, 1, none).board;
  assert.deepEqual(s.analyse(centreLoad(s, a.id, -800), 0.1), [a.id]);
  const b = s.place(-0.5, 0, 1.5, 1, none).board;
  s.analyse(new Map(), 2);
  s.place(1.5, 1, 3.5, 0, none);          // brace to the far bank
  assert.deepEqual(s.analyse(new Map(), 0.1), []);
  assert.equal(s.boards.get(b.id).unstable, false);
});

test('a span between two anchors holds a person but not a camper wheel', () => {
  const { s } = setup(2.8);
  const { board } = s.place(-0.1, 0, 2.9, 0, none);
  assert.deepEqual(s.analyse(centreLoad(s, board.id, -800), 0.1), []);
  assert.ok(s.boards.get(board.id).u < 1, `person utilisation ${s.boards.get(board.id).u}`);
  let fallen = [];
  for (let k = 0; k < 4 && !fallen.length; k++) fallen = s.analyse(centreLoad(s, board.id, -12500), 0.1);
  assert.deepEqual(fallen, [board.id]);
});

test('a braced span (king-post truss) carries a camper wheel', () => {
  const { s } = setup(5.6);
  // Deck in two halves meeting over the gap, propped by two diagonals from the gap walls.
  const left = s.place(-0.1, 0, 2.8, 0, none).board;
  const right = s.place(2.8, 0, 5.7, 0, none).board;
  const struts = [s.place(0.05, -0.9, 2.8, 0, none).board, s.place(5.55, -0.9, 2.8, 0, none).board];
  assert.ok(struts.every(Boolean));
  for (let k = 0; k < 4; k++) assert.deepEqual(s.analyse(centreLoad(s, left.id, -12500), 0.1), [], 'holds under load');
  assert.ok(s.boards.has(right.id));
});

test('digging out an anchor brings the structure down', () => {
  const terrain = { gap: 3, solidAt(x, y) { return y < 0 && (x < 0 || x > this.gap); } };
  const world = new World({ gravity: Vec2(0, -9.81) });
  const s = new Structure(world, terrain);
  s.place(-0.1, 0, 2.9, 0, none);
  assert.deepEqual(s.analyse(), []);
  terrain.gap = 8;   // the far bank is gone
  for (const j of s.joints.values()) if (j.anchor && !s.isAnchorPoint(j.x, j.y)) j.anchor = false;
  let fallen = [];
  for (let k = 0; k < 100 && !fallen.length; k++) fallen = s.analyse(new Map(), 0.1);
  assert.equal(fallen.length, 1);
});

test('camper contact forces load the boards through the physics engine', () => {
  const { world, s } = setup(2.8);
  s.place(-0.1, 0, 2.9, 0, none);
  const wheel = world.createBody({ type: 'dynamic', position: Vec2(1.4, 0.8) });
  wheel.createFixture(new Circle(0.7), { density: 12500 / 9.81 / (Math.PI * 0.49) });
  let fallen = [];
  for (let k = 0; k < 240 && !fallen.length; k++) { world.step(1 / 60); fallen = s.step(1 / 60, []); }
  assert.equal(fallen.length, 1, 'the heavy wheel breaks the unsupported span');
  void Box; void BOARD;
});

test('boards block soil movement across them', () => {
  const { s } = setup();
  s.place(-1, 0, -1, 2, none);
  assert.equal(s.blocksSegment(-1.2, 1, -0.8, 0.9), true);
  assert.equal(s.blocksSegment(-0.6, 1, -0.4, 0.9), false);
});
