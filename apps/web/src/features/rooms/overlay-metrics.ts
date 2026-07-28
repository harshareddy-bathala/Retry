// The pixel contract across the Phaser/DOM boundary.
//
// These numbers were duplicated: RoomScene defined FEET_OFFSET_Y / TAG_OFFSET_Y
// / OVERLAY_ANCHOR_Y, and BubbleOverlay separately defined its own sizes and
// clearance — two files, two coordinate systems, and an implicit agreement that
// nothing enforced. Changing the name-tag height on one side silently detached
// every AV bubble on the other.
//
// Deliberately imports NOTHING. Phaser and React both read it, so a dependency
// either way would make it a cycle.

/**
 * Pack character frames are 32x64 — the head overhangs the tile the avatar
 * occupies — so the feet sit 24px below the sprite's centre. This is the
 * collision anchor and the position that goes on the wire.
 */
export const FEET_OFFSET_Y = 24;

/** The feet box itself, hugging the bottom of the frame. */
export const FEET_BOX = { width: 18, height: 12, offsetX: 7, offsetY: 50 } as const;

/** Name tags float just above the head, which is 32px above the centre. */
export const TAG_OFFSET_Y = 44;

/** Emote and typing bubbles float above the name tag, clear of it. */
export const BUBBLE_OFFSET_Y = TAG_OFFSET_Y + 14;

/**
 * The top of everything Phaser draws above an avatar — the name tag's upper
 * edge. This, not the head, is the anchor published to the DOM overlay, so the
 * overlay's clearance can be a small constant instead of a number that has to
 * grow with camera zoom to stay clear of the tag.
 */
export const OVERLAY_ANCHOR_Y = TAG_OFFSET_Y + 8;

/** Contact shadow under each avatar. */
export const SHADOW = { radiusX: 8, radiusY: 3, alpha: 0.28, offsetY: 22 } as const;

/** AV bubble diameters by proximity zone, and for your own. */
export const BUBBLE_SIZE: Record<'close' | 'near', number> = { close: 72, near: 48 };
export const SELF_BUBBLE_SIZE = 48;

/**
 * Gap between a bubble's bottom edge and the anchor. Cosmetic — everything the
 * scene draws is already below the anchor — so it does not track camera zoom.
 */
export const BUBBLE_CLEARANCE_PX = 8;
