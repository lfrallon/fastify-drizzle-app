CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_resource_unique";--> statement-breakpoint
DROP INDEX "permissions_id_idx";--> statement-breakpoint
DROP INDEX "roles_id_idx";--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role_id" uuid;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "first_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "last_name" text NOT NULL;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "firstName";--> statement-breakpoint
ALTER TABLE "user" DROP COLUMN "lastName";--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_resource_action_unique" UNIQUE("resource","action");