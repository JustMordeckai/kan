ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.board.externalUrl';--> statement-breakpoint
ALTER TABLE "card_board_links" ADD COLUMN "externalUrl" text;