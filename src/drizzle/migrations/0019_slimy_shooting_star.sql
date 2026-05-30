CREATE TABLE "geo_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"geoNote" text NOT NULL,
	"latitude" numeric NOT NULL,
	"longitude" numeric NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text,
	"video_url" text
);
--> statement-breakpoint
DROP TABLE "map_messages" CASCADE;--> statement-breakpoint
ALTER TABLE "geo_notes" ADD CONSTRAINT "geo-notes_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "geo-notes_updated_at_idx" ON "geo_notes" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "geo-notes_lat_lng_updated_at_idx" ON "geo_notes" USING btree ("latitude","longitude","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "geo-notes_id_idx" ON "geo_notes" USING btree ("id");