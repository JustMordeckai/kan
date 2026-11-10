import { index, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Roles of the Discord guild used for role based access, refreshed by every
 * role sync run, so that role ids can be shown by name and colour.
 */
export const discordRoles = pgTable(
  "discord_role",
  {
    roleId: text("roleId").primaryKey(),
    guildId: text("guildId").notNull(),
    name: text("name").notNull(),
    // RGB colour as an integer, 0 when the role has no colour.
    colour: integer("colour").notNull().default(0),
    position: integer("position").notNull().default(0),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (table) => [index("discord_role_guild_idx").on(table.guildId)],
).enableRLS();
