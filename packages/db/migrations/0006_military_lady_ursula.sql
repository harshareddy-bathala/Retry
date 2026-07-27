ALTER TABLE "users" ADD COLUMN "avatar_sprite" text;--> statement-breakpoint
-- The avatar moves from per-room-membership to per-user (a person's character
-- is theirs everywhere), and its value changes from a preset key to the
-- canonical layer-selection string defined in @retry/maps. Carry each user's
-- most recent preset choice across as the equivalent built character
-- (AVATAR_PRESETS in packages/maps/src/avatars.ts — keep in sync by hand).
UPDATE "users" u
SET "avatar_sprite" = CASE rm.avatar_sprite
  WHEN 'maker'     THEN 'body_04|eyes_02|outfit_06|hair_02_02|acc_04'
  WHEN 'planner'   THEN 'body_06|eyes_03|outfit_12|hair_07_07|acc_15'
  WHEN 'nightowl'  THEN 'body_02|eyes_05|outfit_15|hair_11_04|acc_11'
  WHEN 'explorer'  THEN 'body_05|eyes_01|outfit_03|hair_14_07|acc_03'
  WHEN 'tinkerer'  THEN 'body_07|eyes_04|outfit_09|hair_17_03|acc_16'
  WHEN 'connector' THEN 'body_03|eyes_06|outfit_18|hair_20_06|'
  ELSE NULL
END
FROM (
  SELECT DISTINCT ON (user_id) user_id, avatar_sprite
  FROM "room_members"
  WHERE avatar_sprite IS NOT NULL
  ORDER BY user_id, created_at DESC
) rm
WHERE rm.user_id = u.id;--> statement-breakpoint
ALTER TABLE "room_members" DROP COLUMN "avatar_sprite";