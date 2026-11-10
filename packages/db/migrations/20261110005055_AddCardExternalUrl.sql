ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.externalUrl';--> statement-breakpoint
ALTER TABLE "card" ADD COLUMN "externalUrl" text;