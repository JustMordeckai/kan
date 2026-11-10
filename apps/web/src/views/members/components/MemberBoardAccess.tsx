import { t } from "@lingui/core/macro";
import { format } from "date-fns";

import type { RouterOutputs } from "~/utils/api";
import { useLocalisation } from "~/hooks/useLocalisation";
import { formatMemberDisplayName } from "~/utils/helpers";
import { discordColourToHex } from "~/utils/memberBoardAccess";

type BoardAccessData = RouterOutputs["workspace"]["memberBoardAccess"];
export type MemberBoardAccessEntry = BoardAccessData["members"][number];
type MemberBoard = MemberBoardAccessEntry["boards"][number];
type AccessReason = MemberBoard["reasons"][number];
type DiscordRole = BoardAccessData["boards"][number]["discordRoles"][number];

const chipClassName =
  "inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset sm:text-[11px]";

export function DiscordRolePill({ role }: { role: DiscordRole }) {
  const colour = discordColourToHex(role.colour);

  return (
    <span
      className={`${chipClassName} bg-light-100 text-light-1000 ring-light-400 dark:bg-dark-200 dark:text-dark-1000 dark:ring-dark-400`}
      title={role.name ? undefined : role.roleId}
    >
      <span
        aria-hidden
        className="h-2 w-2 flex-shrink-0 rounded-full bg-light-600 dark:bg-dark-600"
        style={colour ? { backgroundColor: colour } : undefined}
      />
      <span className="truncate">{role.name ?? t`Unknown role`}</span>
    </span>
  );
}

function ReasonLabel({ reason }: { reason: AccessReason }) {
  const { dateLocale } = useLocalisation();
  const formatDate = (date: Date) => format(date, "PP", { locale: dateLocale });

  switch (reason.type) {
    case "discord_role":
      return <DiscordRolePill role={reason} />;
    case "workspace_admin":
      return (
        <span className="text-[11px] text-light-900 dark:text-dark-900 sm:text-xs">
          {t`Workspace admin`}
        </span>
      );
    case "discord_sync": {
      const date = formatDate(reason.addedAt);
      return (
        <span className="text-[11px] text-light-900 dark:text-dark-900 sm:text-xs">
          {t`Added by the Discord sync on ${date}`}
        </span>
      );
    }
    case "manual": {
      const date = formatDate(reason.addedAt);
      const author = reason.addedBy
        ? formatMemberDisplayName(reason.addedBy.name, reason.addedBy.email)
        : null;
      return (
        <span className="text-[11px] text-light-900 dark:text-dark-900 sm:text-xs">
          {author ? t`Added by ${author} on ${date}` : t`Added on ${date}`}
        </span>
      );
    }
  }
}

/** A member's boards, each with why the member can open it. */
export function MemberBoardAccessList({
  member,
  boards,
  showDiscordStatus,
}: {
  member: MemberBoardAccessEntry;
  boards: MemberBoard[];
  showDiscordStatus: boolean;
}) {
  return (
    <div className="space-y-2 px-2 pb-3 sm:px-4 sm:pl-[3.75rem]">
      {showDiscordStatus && member.discordExempt && (
        <p className="text-[11px] italic text-light-900 dark:text-dark-900 sm:text-xs">
          {t`Exempt from the Discord role sync`}
        </p>
      )}
      {showDiscordStatus &&
        !member.discordExempt &&
        member.hasDiscordAccount &&
        !member.discordRolesSyncedAt && (
          <p className="text-[11px] italic text-light-900 dark:text-dark-900 sm:text-xs">
            {t`Discord roles not synced yet`}
          </p>
        )}
      {boards.length === 0 ? (
        <p className="text-[11px] text-light-900 dark:text-dark-900 sm:text-xs">
          {t`No board`}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {boards.map((board) => (
            <li
              key={board.boardPublicId}
              className="flex flex-wrap items-center gap-1.5"
            >
              <span
                className={`${chipClassName} bg-light-200 text-neutral-900 ring-light-400 dark:bg-dark-300 dark:text-dark-1000 dark:ring-dark-500`}
              >
                <span className="truncate">{board.name}</span>
              </span>
              {board.isArchived && (
                <span className="text-[11px] italic text-light-900 dark:text-dark-900 sm:text-xs">
                  {t`Archived`}
                </span>
              )}
              {board.boardRole === "admin" && (
                <span className="text-[11px] font-medium text-light-1000 dark:text-dark-1000 sm:text-xs">
                  {t`Board admin`}
                </span>
              )}
              <span aria-hidden className="text-light-700 dark:text-dark-700">
                ·
              </span>
              {board.reasons.map((reason, index) => (
                <ReasonLabel
                  key={reason.type === "discord_role" ? reason.roleId : index}
                  reason={reason}
                />
              ))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Board picker narrowing the member list to the people who reach a board. */
export function BoardAccessFilter({
  data,
  value,
  onChange,
}: {
  data: BoardAccessData;
  value: string | null;
  onChange: (boardPublicId: string | null) => void;
}) {
  const selected = data.boards.find((board) => board.boardPublicId === value);

  return (
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
      <label
        htmlFor="board-access-filter"
        className="text-sm text-light-900 dark:text-dark-900"
      >
        {t`Board access`}
      </label>
      <select
        id="board-access-filter"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="block w-full rounded-md border-0 bg-white/5 py-1.5 text-sm shadow-sm ring-1 ring-inset ring-light-600 focus:ring-2 focus:ring-inset focus:ring-light-700 dark:text-dark-1000 dark:ring-dark-700 dark:focus:ring-dark-700 sm:w-64 sm:leading-6"
      >
        <option value="">{t`All boards`}</option>
        {data.boards.map((board) => (
          <option key={board.boardPublicId} value={board.boardPublicId}>
            {board.name}
          </option>
        ))}
      </select>
      {selected && data.discordRoleAccessEnabled && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.discordRoles.length ? (
            <>
              <span className="text-[11px] text-light-900 dark:text-dark-900 sm:text-xs">
                {t`Discord roles:`}
              </span>
              {selected.discordRoles.map((role) => (
                <DiscordRolePill key={role.roleId} role={role} />
              ))}
            </>
          ) : (
            <span className="text-[11px] text-light-900 dark:text-dark-900 sm:text-xs">
              {t`No Discord role: members are added by hand`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
