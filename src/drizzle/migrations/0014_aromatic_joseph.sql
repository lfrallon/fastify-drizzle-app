ALTER TABLE "user" DROP CONSTRAINT "user_role_permission_id_role_permission_id_fk";
--> statement-breakpoint
DROP INDEX "user_rolePermissionId_idx";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "role_permission_id";