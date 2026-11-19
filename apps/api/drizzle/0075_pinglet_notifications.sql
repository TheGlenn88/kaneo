ALTER TABLE "user_notification_preference" ADD COLUMN "pinglet_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "pinglet_namespace" text;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "pinglet_topic" text;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "pinglet_token" text;--> statement-breakpoint
ALTER TABLE "user_notification_workspace_rule" ADD COLUMN "pinglet_enabled" boolean DEFAULT false NOT NULL;