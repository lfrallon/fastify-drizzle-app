ALTER TABLE "user" ALTER COLUMN "role_id" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "user" ALTER COLUMN "role_id" DROP NOT NULL;