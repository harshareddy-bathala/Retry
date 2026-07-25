CREATE TYPE "public"."blueprint_field" AS ENUM('problem', 'audience', 'existing');--> statement-breakpoint
CREATE TYPE "public"."domain_tag" AS ENUM('Education', 'Healthcare', 'Fintech', 'Logistics', 'Government', 'Social', 'Productivity', 'Other');--> statement-breakpoint
CREATE TYPE "public"."journey_kind" AS ENUM('room_created', 'blueprint_first_edit', 'stage_change');--> statement-breakpoint
CREATE TYPE "public"."project_stage" AS ENUM('ideation', 'planning', 'building', 'testing', 'complete');--> statement-breakpoint
CREATE TABLE "room_blueprint" (
	"room_id" uuid PRIMARY KEY NOT NULL,
	"problem" text,
	"audience" text,
	"existing" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_blueprint_edits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"field" "blueprint_field" NOT NULL,
	"user_id" uuid NOT NULL,
	"value" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "room_journey_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"kind" "journey_kind" NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "project_stage" "project_stage" DEFAULT 'ideation' NOT NULL;--> statement-breakpoint
ALTER TABLE "rooms" ADD COLUMN "domain_tag" "domain_tag";--> statement-breakpoint
ALTER TABLE "room_blueprint" ADD CONSTRAINT "room_blueprint_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_blueprint_edits" ADD CONSTRAINT "room_blueprint_edits_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_blueprint_edits" ADD CONSTRAINT "room_blueprint_edits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "room_journey_entries" ADD CONSTRAINT "room_journey_entries_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "room_blueprint_edits_room_idx" ON "room_blueprint_edits" USING btree ("room_id","created_at");--> statement-breakpoint
CREATE INDEX "room_journey_entries_room_idx" ON "room_journey_entries" USING btree ("room_id","created_at");