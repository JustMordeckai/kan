CREATE TABLE IF NOT EXISTS "discord_role" (
	"roleId" text PRIMARY KEY NOT NULL,
	"guildId" text NOT NULL,
	"name" text NOT NULL,
	"colour" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "discord_role" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "discordRoleIds" text[];--> statement-breakpoint
ALTER TABLE "workspace_members" ADD COLUMN "discordRolesSyncedAt" timestamp;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "discord_role_guild_idx" ON "discord_role" USING btree ("guildId");