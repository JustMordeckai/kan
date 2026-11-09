import {
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Transition,
} from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { useState } from "react";
import { HiChevronDown } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import Button from "~/components/Button";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface Option {
  publicId: string;
  name: string;
}

function OptionSelect({
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-light-900 dark:text-dark-900">
        {label}
      </label>
      <Listbox value={value} onChange={onChange}>
        <div className="relative">
          <ListboxButton
            className={twMerge(
              "relative w-full cursor-pointer rounded-md border border-light-300 bg-white py-2 pl-3 pr-10 text-left text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-light-400 focus:ring-offset-0 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:focus:ring-dark-500",
              !value && "text-light-600 dark:text-dark-600",
            )}
          >
            <span className="block truncate">
              {options.find((option) => option.publicId === value)?.name ??
                placeholder}
            </span>
            <span className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 items-center">
              <HiChevronDown
                className="h-4 w-4 text-light-600 dark:text-dark-600"
                aria-hidden
              />
            </span>
          </ListboxButton>
          <Transition
            leave="transition ease-in duration-100"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <ListboxOptions className="absolute z-50 mt-1 w-full overflow-hidden rounded-md border border-light-200 bg-white shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-dark-400 dark:bg-dark-200">
              <div className="scrollbar-track-rounded-[4px] scrollbar-thumb-rounded-[4px] scrollbar-w-[8px] max-h-60 overflow-y-auto py-1 pr-1 scrollbar scrollbar-track-light-200 scrollbar-thumb-light-400 dark:scrollbar-track-dark-100 dark:scrollbar-thumb-dark-600">
                {options.map((option) => (
                  <ListboxOption
                    key={option.publicId}
                    value={option.publicId}
                    className={({ focus }) =>
                      twMerge(
                        "relative cursor-pointer select-none py-2 pl-3 pr-9 text-sm",
                        focus
                          ? "bg-light-200 text-light-1000 dark:bg-dark-400 dark:text-dark-1000"
                          : "text-light-900 dark:text-dark-900",
                      )
                    }
                  >
                    {option.name}
                  </ListboxOption>
                ))}
              </div>
            </ListboxOptions>
          </Transition>
        </div>
      </Listbox>
    </div>
  );
}

export function ShareCardModal({ cardPublicId }: { cardPublicId?: string }) {
  const { entityId, closeModal } = useModal();
  const { showPopup } = usePopup();
  const { workspace } = useWorkspace();
  const utils = api.useUtils();
  const publicId = cardPublicId ?? entityId;

  const [boardPublicId, setBoardPublicId] = useState("");
  const [listPublicId, setListPublicId] = useState("");

  const { data: card, isLoading: isCardLoading } = api.card.byId.useQuery(
    { cardPublicId: publicId },
    { enabled: publicId.length >= 12 },
  );
  const { data: boards, isLoading: isBoardsLoading } = api.board.all.useQuery(
    { workspacePublicId: workspace.publicId, type: "regular" },
    { enabled: !!workspace.publicId },
  );

  const unavailable = new Set([
    card?.list.board.publicId,
    ...(card?.sharedBoards.map((board) => board.publicId) ?? []),
  ]);
  const boardOptions =
    boards?.filter((board) => !unavailable.has(board.publicId)) ?? [];
  const listOptions =
    boardOptions.find((board) => board.publicId === boardPublicId)?.lists ?? [];

  const shareCard = api.card.share.useMutation({
    onSuccess: () => {
      showPopup({
        header: t`Card shared`,
        icon: "success",
        message: t`The card now also appears on the selected board.`,
      });
      closeModal();
    },
    onError: (error) => {
      showPopup({
        header: t`Unable to share card`,
        icon: "error",
        message: error.message,
      });
    },
    onSettled: async () => {
      await invalidateCard(utils, publicId);
      await utils.board.byId.invalidate();
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!boardPublicId || !listPublicId) return;
    shareCard.mutate({ cardPublicId: publicId, boardPublicId, listPublicId });
  };

  if (!publicId) return null;

  return (
    <form onSubmit={handleSubmit} className="p-4">
      <h2 className="mb-1 text-lg font-semibold text-light-1000 dark:text-dark-1000">
        {t`Share with a board`}
      </h2>
      <p className="mb-4 text-sm text-light-900 dark:text-dark-900">
        {t`The same card shows on both boards: changes made on one are visible on the other.`}
      </p>
      <div className="space-y-4">
        <OptionSelect
          label={t`Board`}
          placeholder={
            !isBoardsLoading && boardOptions.length === 0
              ? t`No other board available`
              : t`Select a board`
          }
          value={boardPublicId}
          options={boardOptions}
          onChange={(value) => {
            setBoardPublicId(value);
            setListPublicId("");
          }}
        />
        <OptionSelect
          label={t`List`}
          placeholder={t`Select a list`}
          value={listPublicId}
          options={listOptions}
          onChange={setListPublicId}
        />
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={closeModal}>
          {t`Cancel`}
        </Button>
        <Button
          type="submit"
          variant="primary"
          disabled={
            !boardPublicId ||
            !listPublicId ||
            isCardLoading ||
            shareCard.isPending
          }
        >
          {t`Share`}
        </Button>
      </div>
    </form>
  );
}
