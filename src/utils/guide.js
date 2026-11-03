// Shared timing / sizing for the panda guide, the lift sequence and the
// first-person camera. Kept free of three.js so App.jsx and the tests can use it.

// Walking pace of the guide (was 1.35 m/s; a little brisker now).
export const WALK_SPEED_MPS = 1.9;

// Lift sequence (ms)
export const BOARD_MS = 1300;   // cut to the cabin: doors close behind you
export const RIDE_MS = 5000;    // inside the lift, doors shut, floor counter running (about 5 s)
export const EXIT_MS = 2900;    // doors open, the guide steps out, then waits for you

// Where the lift cabin interior lives: far away from the mall so it never
// overlaps the floor plan. The camera simply teleports there.
export const CABIN_ORIGIN = [400, 400];

// First-person eye height (scene units; shop blocks are 0.9 high).
export const EYE_HEIGHT = 0.72;
