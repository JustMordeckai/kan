import Link from "next/link";
import { t } from "@lingui/core/macro";
import { HiXMark } from "react-icons/hi2";

import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface SharedBoard {
  publicId: string;
  name: string;
  list: { publicId: string; name: string };
}

export default function SharedBoards({
  cardPublicId,
  homeBoard,
  sharedBoards,
  canEdit,
}: {
  cardPublicId: string;
  homeBoard: { publicId: string; name: string; canAccess: boolean };
  sharedBoards: SharedBoard[];
  canEdit: boolean;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();

  const unshare = api.card.unshare.useMutation({
    onError: (error) => {
      showPopup({
        header: t`Unable to remove card from board`,
        message: error.message,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  const boardLinkClass =
    "truncate text-sm text-light-1000 hover:underline dark:text-dark-1000";

  return (
    <ul className="flex min-w-0 flex-1 flex-col gap-1 py-2">
      <li className="flex min-w-0 items-center gap-1">
        {homeBoard.canAccess ? (
          <Link
            href={`/boards/${homeBoard.publicId}`}
            className={boardLinkClass}
          >
            {homeBoard.name}
          </Link>
        ) : (
          <span className="truncate text-sm text-light-1000 dark:text-dark-1000">
            {homeBoard.name}
          </span>
        )}
        <span className="shrink-0 text-xs text-light-800 dark:text-dark-800">
          {t`(home)`}
        </span>
      </li>
      {sharedBoards.map(({ publicId, name, list }) => (
        <li key={publicId} className="flex min-w-0 items-center gap-1">
          <Link
            href={`/boards/${publicId}`}
            className={boardLinkClass}
            title={list.name}
          >
            {name}
          </Link>
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                unshare.mutate({ cardPublicId, boardPublicId: publicId })
              }
              disabled={unshare.isPending}
              aria-label={t`Remove from ${name}`}
              title={t`Remove from ${name}`}
              className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-light-800 hover:bg-light-200 disabled:opacity-50 dark:text-dark-800 dark:hover:bg-dark-200"
            >
              <HiXMark className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
