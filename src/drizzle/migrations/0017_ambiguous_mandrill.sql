CREATE TYPE "public"."action" AS ENUM('create', 'read', 'update', 'delete');--> statement-breakpoint
ALTER TABLE "role_permission" ALTER COLUMN "permission" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "role_permission" ADD COLUMN "resource" text NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permission" ADD COLUMN "action" "action" NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permission" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
DROP TYPE "public"."permission";