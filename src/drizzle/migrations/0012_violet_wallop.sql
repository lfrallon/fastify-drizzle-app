ALTER TABLE "user" ADD COLUMN "role_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role_permission_id" text;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_role_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."role"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_permission_id_role_permission_id_fk" FOREIGN KEY ("role_permission_id") REFERENCES "public"."role_permission"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_roleId_idx" ON "user" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "user_rolePermissionId_idx" ON "user" USING btree ("role_permission_id");--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "permissions";--> statement-breakpoint
DROP TYPE "public"."user_permissions";--> statement-breakpoint
DROP TYPE "public"."user_role";