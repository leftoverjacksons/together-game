// World units are metres, y points up.
export const CELL = 0.25;            // terrain grid spacing
export const CHUNK = 32;             // cells per chunk side
export const WORLD_HEIGHT = 48;      // metres of terrain grid above y = 0
export const STRETCH_LENGTH = 640;   // metres per stretch (M1 test length)

export const TICK_HZ = 60;
export const SNAPSHOT_HZ = 20;
export const GRAVITY = -12;

export const REACH = 3.4;            // how far a player can dig or place soil
export const BRUSH_RADIUS = 0.55;
export const SOIL_CAPACITY = 4;      // m² of soil one player can carry
export const LEASH = 30;             // max horizontal distance from the camper on foot
export const MAX_PLAYERS = 2;

// Camper interior, in chassis-local metres.
export const INTERIOR = { minX: -2.75, maxX: 2.45, floorY: -0.35, doorX: -2.45, seatX: 1.95 };
export const STATION_RANGE = 0.6;
export const DOOR_RANGE = 1.8;       // board when this close to the door (world distance)
