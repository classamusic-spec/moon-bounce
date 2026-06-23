// Core gameplay constants.
//
// IMPORTANT (from the prototype, kept faithfully): these must be available
// before the PLANETS data is built — the planet terrain data references
// LEVEL_LEN. As ES module imports they resolve before use, so the original
// temporal-dead-zone ordering hazard no longer applies, but the values are
// unchanged from the shipped prototype.
export const LEVEL_LEN = 95;
export const GROUND_Y = -2.0;
export const CHAR_R = 0.7;

// Horizontal walk speed (per physics step at 60fps reference).
export const MOVE_SPEED = 0.10;

// The flight mini-game is a true 60 real seconds.
export const FLIGHT_SECONDS = 60;
