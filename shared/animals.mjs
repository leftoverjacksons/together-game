import { mulberry32 } from './rng.mjs';

// Animals along the stretch. Each starts in trouble and is rescued by
// travellers on foot:
//   free  – hold E beside it (untangle, unsnare); two people work twice as fast
//   dig   – it is trapped in a collapsed burrow: dig the soil off it
//   saw   – a fallen branch pins it: saw the branch or haul it away
//   carry – it is hurt: carry it to the camper
// Small animals ride in the camper (the score). Large animals walk or fly
// alongside and help when the camper struggles. The dog is a companion.

export const ANIMALS = {
  dog:      { size: 'dog',   rescue: 'free',  work: 1.5, mass: 25, lane: 0, verb: 'make friends with the dog' },
  rabbit:   { size: 'small', rescue: 'dig',   work: 0,   mass: 3,  lane: 0, verb: 'dig the rabbit out of its collapsed burrow' },
  chipmunk: { size: 'small', rescue: 'saw',   work: 0,   mass: 1,  lane: 0, verb: 'free the chipmunk pinned under the branch' },
  songbird: { size: 'small', rescue: 'free',  work: 2.5, mass: 0.3, lane: 1, verb: 'untangle the songbird from the brambles' },
  fox:      { size: 'small', rescue: 'free',  work: 3.5, mass: 7,  lane: 1, verb: 'open the snare on the fox\'s leg' },
  deer:     { size: 'large', rescue: 'free',  work: 5,   mass: 0,  lane: 1, helps: 'pull', force: 9000, verb: 'cut the deer free of the old fence wire' },
  hawk:     { size: 'large', rescue: 'carry', work: 0,   mass: 0,  lane: 1, helps: 'lift', force: 8000, verb: 'carry the injured hawk to the camper' },
  moose:    { size: 'large', rescue: 'free',  work: 7,   mass: 0,  lane: 0, helps: 'push', force: 12000, verb: 'help the moose out of the mud' },
  bear:     { size: 'large', rescue: 'free',  work: 9,   mass: 0,  lane: 1, helps: 'push', force: 15000, verb: 'open the trap on the bear\'s paw' },
};

export const RESCUE_RANGE = 1.6;
export const HELP_STAMINA = { drain: 1 / 10, recover: 1 / 22, min: 0.25 };

// Riding spots inside the camper (chassis-local metres), for small animals and the dog.
export const RIDE_SPOTS = [[-2.55, 0.15], [0.05, 1.33], [-0.7, -0.35], [0.25, 0.45], [-2.2, 0.15], [0.4, 1.33], [-1.6, -0.35], [-0.1, 0.45]];

export function placeAnimals(length, seed) {
  const rand = mulberry32(seed ^ 0xa11ce);
  const list = [{ kind: 'dog', x: 46 + rand() * 6 }];
  const small = ['rabbit', 'chipmunk', 'songbird', 'fox', 'rabbit', 'songbird', 'chipmunk'];
  const large = ['deer', 'hawk', 'moose', 'bear'];
  for (let k = large.length - 1; k > 0; k--) { const j = Math.floor(rand() * (k + 1)); [large[k], large[j]] = [large[j], large[k]]; }
  let x = 75 + rand() * 15, si = 0, li = 0, n = 0;
  while (x < length - 50) {
    const kind = n % 2 === 1 && li < large.length ? large[li++] : small[si++ % small.length];
    list.push({ kind, x });
    x += 45 + rand() * 35;
    n++;
  }
  return list;
}
