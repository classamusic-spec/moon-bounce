// Core gameplay constants.
//
// IMPORTANT (from the prototype, kept faithfully): these must be available
// before the PLANETS data is built — the planet terrain data references
// LEVEL_LEN. As ES module imports they resolve before use, so the original
// temporal-dead-zone ordering hazard no longer applies, but the values are
// unchanged from the shipped prototype.
// Playable span of a horizontal level. Levels were originally 95 units; they
// are now substantially longer so each world can carry a full sequence of
// authored beats (arrival -> teach -> rise -> signature -> rest -> flourish ->
// finale) instead of a single short strip.
export const LEVEL_LEN = 240;

/** The span the hand-authored planet coordinates were written against. */
export const LEGACY_LEN = 95;
/** Maps a hand-authored x (steps, wind zones, geysers, power boxes, secrets)
 *  from the original 95-unit space onto the current, longer span. Keeps all
 *  eight planets' authored data valid without rewriting every number. */
export const SPAN_SCALE = LEVEL_LEN / LEGACY_LEN;
/** Scale one authored x position into the current level span. */
export function sx(x: number): number { return x * SPAN_SCALE; }

export const GROUND_Y = -2.0;
export const CHAR_R = 0.7;

// Horizontal walk speed (per physics step at 60fps reference).
export const MOVE_SPEED = 0.10;

// The Long Drift between worlds. Kept deliberately SHORTER than a level:
// travel is a breather between places, never the main event.
export const FLIGHT_SECONDS = 25;
