ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.completed' BEFORE 'card.archived';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.uncompleted' BEFORE 'card.archived';--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "completed" boolean DEFAULT false NOT NULL;