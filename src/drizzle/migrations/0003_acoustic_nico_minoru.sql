ALTER TABLE "user" ALTER COLUMN "permissions" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."user_permissions";--> statement-breakpoint
CREATE TYPE "public"."user_permissions" AS ENUM('Create', 'Read', 'Update', 'Delete');--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "permissions" SET DATA TYPE "public"."user_permissions"[] USING "permissions"::"public"."user_permissions"[];--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "permissions" DROP DEFAULT;