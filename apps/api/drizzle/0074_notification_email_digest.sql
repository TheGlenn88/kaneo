ALTER TABLE "notification" ADD COLUMN "email_digest_queued_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "email_digest_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "user_notification_preference" ADD COLUMN "last_email_digest_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "notification_email_digest_queued_idx" ON "notification" USING btree ("user_id","email_digest_queued_at") WHERE "notification"."email_digest_queued_at" IS NOT NULL;