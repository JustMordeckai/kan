import { z } from "zod";

import { boardBackgroundSchema } from "./board";
import { userSchema } from "./common";

// ─── workspace.all ───────────────────────────────────────────
export const workspaceListItemSchema = z.object({
  role: z.string(),
  workspace: z.object({
    publicId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    image: z.string().nullable(),
    slug: z.string(),
    plan: z.enum(["free", "team", "pro", "enterprise"]),
    weekStartDay: z.number().nullable(),
    cardPrefix: z.string(),
    deletedAt: z.date().nullable(),
  }),
});

// ─── workspace.byId ──────────────────────────────────────────
const workspaceMemberDetailSchema = z.object({
  publicId: z.string(),
  email: z.string().optional(),
  role: z.string(),
  status: z.string(),
  createdAt: z.date(),
  user: z
    .object({
      id: z.string().nullable(),
      name: z.string().nullable(),
      email: z.string().optional(),
      image: z.string().nullable(),
    })
    .nullable(),
});

const workspaceSubscriptionSchema = z.object({
  plan: z.string(),
  status: z.string(),
  seats: z.number().nullable(),
  unlimitedSeats: z.boolean().nullable(),
  partnerTier: z.number().nullable(),
  periodStart: z.date().nullable(),
  periodEnd: z.date().nullable(),
});

export const workspaceDetailSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
  showEmailsToMembers: z.boolean().nullable(),
  weekStartDay: z.number().nullable(),
  members: z.array(workspaceMemberDetailSchema),
  subscriptions: z.array(workspaceSubscriptionSchema),
});

// ─── workspace.bySlug ────────────────────────────────────────
export const workspaceWithBoardsSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  slug: z.string(),
  boards: z.array(
    z.object({
      publicId: z.string(),
      slug: z.string(),
      name: z.string(),
      background: boardBackgroundSchema.nullable(),
    }),
  ),
});

// ─── workspace.create ────────────────────────────────────────
export const workspaceCreateResponseSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  plan: z.enum(["free", "team", "pro", "enterprise"]),
  cardPrefix: z.string(),
});

// ─── workspace.update ────────────────────────────────────────
export const workspaceUpdateResponseSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string().nullable(),
  plan: z.enum(["free", "team", "pro", "enterprise"]),
  showEmailsToMembers: z.boolean().nullable(),
  weekStartDay: z.number().nullable(),
});

// ─── workspace.delete ────────────────────────────────────────
export const workspaceDeleteResponseSchema = z.object({
  success: z.boolean(),
});

// ─── workspace.discordAccounts ───────────────────────────────
export const workspaceDiscordAccountSchema = z.object({
  memberPublicId: z.string(),
  userId: z.string(),
  discordId: z.string(),
});

// ─── workspace.memberBoardAccess ─────────────────────────────
const discordRoleRefSchema = z.object({
  roleId: z.string(),
  name: z.string().nullable(),
  colour: z.number().int().nullable(),
});

export const boardAccessReasonSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workspace_admin") }),
  discordRoleRefSchema.extend({ type: z.literal("discord_role") }),
  z.object({ type: z.literal("discord_sync"), addedAt: z.date() }),
  z.object({
    type: z.literal("manual"),
    addedBy: z
      .object({ name: z.string().nullable(), email: z.string() })
      .nullable(),
    addedAt: z.date(),
  }),
]);

export const workspaceMemberBoardAccessSchema = z.object({
  discordRoleAccessEnabled: z.boolean(),
  boards: z.array(
    z.object({
      boardPublicId: z.string(),
      name: z.string(),
      isArchived: z.boolean(),
      discordRoles: z.array(discordRoleRefSchema),
    }),
  ),
  members: z.array(
    z.object({
      memberPublicId: z.string(),
      userId: z.string().nullable(),
      name: z.string().nullable(),
      email: z.string(),
      image: z.string().nullable(),
      workspaceRole: z.string(),
      hasDiscordAccount: z.boolean(),
      discordExempt: z.boolean(),
      discordRolesSyncedAt: z.date().nullable(),
      boards: z.array(
        z.object({
          boardPublicId: z.string(),
          name: z.string(),
          isArchived: z.boolean(),
          boardRole: z.enum(["admin", "member"]).nullable(),
          reasons: z.array(boardAccessReasonSchema),
        }),
      ),
    }),
  ),
});
