CREATE TYPE "public"."user_role" AS ENUM('Admin', 'User', 'Guest');--> statement-breakpoint
ALTER TYPE "public"."user_permissions" ADD VALUE 'Update';--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" "user_role" DEFAULT 'User' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "roles";--> statement-breakpoint
DROP TYPE "public"."user_roles";