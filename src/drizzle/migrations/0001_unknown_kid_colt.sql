CREATE TYPE "public"."user_permissions" AS ENUM('Read', 'Write', 'Delete');--> statement-breakpoint
CREATE TYPE "public"."user_roles" AS ENUM('Admin', 'User', 'Guest');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "roles" "user_roles"[] DEFAULT '{"User"}' NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "permissions" "user_permissions"[] DEFAULT '{"Read","Write"}' NOT NULL;