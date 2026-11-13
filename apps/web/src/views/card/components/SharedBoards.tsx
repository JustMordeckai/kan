import Link from "next/link";
import { t } from "@lingui/core/macro";
import { FaDiscord } from "react-icons/fa";
import {
  HiEllipsisHorizontal,
  HiOutlineHome,
  HiOutlineLink,
  HiXMark,
} from "react-icons/hi2";

import Dropdown from "~/components/Dropdown";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { parseCardExternalLink } from "~/utils/cardExternalLink";
import { invalidateCard } from "~/utils/cardInvalidation";

interface SharedBoard {
  publicId: string;
  name: string;
  list: { publicId: string; name: string };
  externalUrl: string | null;
}

// Small icon opening the card's link on a board (e.g. that board's Discord
// thread).
function BoardLinkIcon({
  externalUrl,
  boardName,
}: {
  externalUrl: string | null;
  boardName: string;
}) {
  const link = parseCardExternalLink(externalUrl);

  if (!link) return null;

  const label = link.isDiscord
    ? t`Open in Discord (${boardName})`
    : t`Open link (${boardName})`;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={label}
      aria-label={label}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-light-800 hover:bg-light-200 hover:text-light-1000 dark:text-dark-800 dark:hover:bg-dark-200 dark:hover:text-dark-1000"
    >
      {link.isDiscord ? (
        <FaDiscord className="h-3.5 w-3.5" aria-hidden="true" />
      ) : (
        <HiOutlineLink className="h-3.5 w-3.5" aria-hidden="true" />
      )}
    </a>
  );
}

export default function SharedBoards({
  cardPublicId,
  homeBoard,
  sharedBoards,
  homeExternalUrl,
  canEdit,
}: {
  cardPublicId: string;
  homeBoard: { publicId: string; name: string; canAccess: boolean };
  sharedBoards: SharedBoard[];
  // The card's own link, which belongs to its home board.
  homeExternalUrl: string | null;
  canEdit: boolean;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const { openModal } = useModal();

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

  const setHomeBoard = api.card.setHomeBoard.useMutation({
    onError: (error) => {
      showPopup({
        header: t`Unable to change the origin board`,
        message: error.message,
        icon: "error",
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, cardPublicId);
      await utils.board.byId.invalidate();
    },
  });

  // Moving the card takes being on its current home board too; sharedBoards
  // only lists boards the viewer is on.
  const canSetHome = canEdit && homeBoard.canAccess;

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
        <BoardLinkIcon
          externalUrl={homeExternalUrl}
          boardName={homeBoard.name}
        />
      </li>
      {sharedBoards.map(({ publicId, name, list, externalUrl }) => (
        <li key={publicId} className="flex min-w-0 items-center gap-1">
          <Link
            href={`/boards/${publicId}`}
            className={boardLinkClass}
            title={list.name}
          >
            {name}
          </Link>
          <BoardLinkIcon externalUrl={externalUrl} boardName={name} />
          {canEdit && (
            <div className="-my-1 ml-auto shrink-0">
              <Dropdown
                ariaLabel={t`Board options for ${name}`}
                items={[
                  ...(canSetHome
                    ? [
                        {
                          label: t`Make this the origin board`,
                          action: () =>
                            setHomeBoard.mutate({
                              cardPublicId,
                              boardPublicId: publicId,
                            }),
                          icon: (
                            <HiOutlineHome className="h-[16px] w-[16px] text-dark-900" />
                          ),
                          disabled: setHomeBoard.isPending,
                        },
                      ]
                    : []),
                  {
                    label: externalUrl
                      ? t`Edit the link on this board`
                      : t`Add a link on this board`,
                    action: () => openModal("EDIT_SHARED_BOARD_LINK", publicId),
                    icon: (
                      <HiOutlineLink className="h-[16px] w-[16px] text-dark-900" />
                    ),
                  },
                ]}
              >
                <HiEllipsisHorizontal className="h-3.5 w-3.5 text-light-800 dark:text-dark-800" />
              </Dropdown>
            </div>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() =>
                unshare.mutate({ cardPublicId, boardPublicId: publicId })
              }
              disabled={unshare.isPending}
              aria-label={t`Remove from ${name}`}
              title={t`Remove from ${name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-light-800 hover:bg-light-200 disabled:opacity-50 dark:text-dark-800 dark:hover:bg-dark-200"
            >
              <HiXMark className="h-3.5 w-3.5" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
