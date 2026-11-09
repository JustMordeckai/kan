import { t } from "@lingui/core/macro";
import { useLingui } from "@lingui/react";
import { useEffect, useRef } from "react";
import {
  HiLink,
  HiOutlineArrowsRightLeft,
  HiOutlineCalendar,
  HiOutlineDocumentDuplicate,
  HiOutlineTag,
  HiOutlineTrash,
  HiOutlineUserGroup,
  HiOutlineArrowRightCircle,
  HiOutlineXCircle,
} from "react-icons/hi2";

export type CardContextMenuAction =
  | "members"
  | "move"
  | "labels"
  | "dueDate"
  | "copyLink"
  | "duplicate"
  | "delete"
  | "share"
  | "unshare";

interface CardContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onAction: (action: CardContextMenuAction) => void;
  canEdit: boolean;
  canShare?: boolean;
  isShared?: boolean;
}

const MENU_ITEMS: {
  action: CardContextMenuAction;
  label: () => string;
  icon: React.ReactNode;
  requiresEdit: boolean;
  // Shared cards are managed from their home board, except for these.
  shown?: "own" | "shared";
}[] = [
  {
    action: "members",
    label: () => t`Manage members`,
    icon: <HiOutlineUserGroup className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "move",
    label: () => t`Move to another list`,
    icon: <HiOutlineArrowRightCircle className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
    shown: "own",
  },
  {
    action: "labels",
    label: () => t`Add / edit label`,
    icon: <HiOutlineTag className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "dueDate",
    label: () => t`Set due date`,
    icon: <HiOutlineCalendar className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "copyLink",
    label: () => t`Copy link to card`,
    icon: <HiLink className="h-4 w-4 shrink-0" />,
    requiresEdit: false,
  },
  {
    action: "duplicate",
    label: () => t`Duplicate card`,
    icon: <HiOutlineDocumentDuplicate className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
    shown: "own",
  },
  {
    action: "share",
    label: () => t`Share with a board`,
    icon: <HiOutlineArrowsRightLeft className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
  },
  {
    action: "unshare",
    label: () => t`Remove from this board`,
    icon: <HiOutlineXCircle className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
    shown: "shared",
  },
  {
    action: "delete",
    label: () => t`Delete card`,
    icon: <HiOutlineTrash className="h-4 w-4 shrink-0" />,
    requiresEdit: true,
    shown: "own",
  },
];

export function CardContextMenu({
  x,
  y,
  onClose,
  onAction,
  canEdit,
  canShare = false,
  isShared = false,
}: CardContextMenuProps) {
  useLingui();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  const items = MENU_ITEMS.filter(
    (item) =>
      (!item.requiresEdit || canEdit) &&
      (item.action !== "share" || canShare) &&
      (item.shown === undefined ||
        item.shown === (isShared ? "shared" : "own")),
  );

  return (
    <div
      ref={menuRef}
      className="fixed z-[200] min-w-[200px] rounded-md border border-light-200 bg-white py-1 shadow-lg dark:border-dark-400 dark:bg-dark-200"
      style={{ left: x, top: y }}
    >
      {items.map(({ action, label, icon }) => (
        <button
          key={action}
          type="button"
          onClick={() => {
            onAction(action);
            onClose();
          }}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-1000 dark:hover:bg-dark-400"
        >
          {icon}
          {label()}
        </button>
      ))}
    </div>
  );
}
