ALTER TABLE "todos" ADD COLUMN "latitude" real;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "longitude" real;--> statement-breakpoint
ALTER TABLE "todos" ADD COLUMN "map_message" text;--> statement-breakpoint
COMMENT ON COLUMN "todos"."latitude" IS 'Nullable for backward compatibility; legacy todos may not have coordinates until backfilled.';--> statement-breakpoint
COMMENT ON COLUMN "todos"."longitude" IS 'Nullable for backward compatibility; legacy todos may not have coordinates until backfilled.';
