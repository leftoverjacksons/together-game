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
export const INTERIOR = { minX: -2.75, maxX: 2.45, floorY: -0.35, doorX: -2.45, seatX: 1.95, winchX: 0.85, toolboxX: -1.25 };
export const STATION_RANGE = 0.6;
export const DOOR_RANGE = 1.8;       // board when this close to the door (world distance)

// Tools and items. Each traveller has TOOL_SLOTS slots; spares live in the
// camper's toolbox or lie in the world to be found.
export const TOOLS = ['shovel', 'axe', 'saw', 'hammer', 'pickaxe', 'jack'];
export const TOOL_NAMES = { shovel: 'Shovel', axe: 'Axe', saw: 'Saw', hammer: 'Hammer', pickaxe: 'Pickaxe', jack: 'Jack' };
export const TOOL_SLOTS = 3;
export const START_TOOLS = [['shovel', 'axe', 'hammer'], ['shovel', 'saw', 'hammer']];
export const START_TOOLBOX = ['saw', 'axe'];
export const TOOLBOX_SIZE = 6;
export const ITEM_RANGE = 1.3;
export const GIVE_RANGE = 1.8;

// Winch: a cable from the front bumper to an anchor, reeled from inside.
export const WINCH = { x: 3.35, y: -0.05, maxLen: 30, force: 26000, k: 45000, c: 7000, reel: 1.3, attachRange: 1.4 };
export const BOARD_CARRY = 4;        // boards one player can carry
export const RACK_BOARDS = 24;       // roof rack capacity
export const RACK_LOGS = 3;
export const BOARD_MASS = 14;        // kg
export const LOG_DENSITY = 200;      // kg/m² (2D); a 4 m log is ~340 kg
export const RACK_POINT = { x: 3.25, y: -0.35 };   // chassis-local ladder at the front bumper
export const RACK_RANGE = 1.9;
export const WORK_RANGE = 1.7;       // reach for chopping, sawing, grabbing
export const CARRY_SPEED = [1.3, 3.4];   // walking speed hauling a log alone / together
