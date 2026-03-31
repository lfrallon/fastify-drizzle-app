CREATE TABLE "map_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"mapMessage" text NOT NULL,
	"latitude" numeric NOT NULL,
	"longitude" numeric NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text
);
--> statement-breakpoint
ALTER TABLE "map_messages" ADD CONSTRAINT "map_messages_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "map_messages_updated_at_idx" ON "map_messages" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "map_messages_id_idx" ON "map_messages" USING btree ("id");