ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.board.added';--> statement-breakpoint
ALTER TYPE "public"."card_activity_type" ADD VALUE 'card.updated.board.removed';--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "card_board_links" (
	"cardId" bigint NOT NULL,
	"boardId" bigint NOT NULL,
	"listId" bigint NOT NULL,
	"index" integer NOT NULL,
	"createdBy" uuid,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "card_board_links_cardId_boardId_pk" PRIMARY KEY("cardId","boardId")
);
--> statement-breakpoint
ALTER TABLE "card_board_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_board_links" ADD CONSTRAINT "card_board_links_cardId_card_id_fk" FOREIGN KEY ("cardId") REFERENCES "public"."card"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_board_links" ADD CONSTRAINT "card_board_links_boardId_board_id_fk" FOREIGN KEY ("boardId") REFERENCES "public"."board"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_board_links" ADD CONSTRAINT "card_board_links_listId_list_id_fk" FOREIGN KEY ("listId") REFERENCES "public"."list"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "card_board_links" ADD CONSTRAINT "card_board_links_createdBy_user_id_fk" FOREIGN KEY ("createdBy") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_board_links_board_idx" ON "card_board_links" USING btree ("boardId");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "card_board_links_list_idx" ON "card_board_links" USING btree ("listId","index");