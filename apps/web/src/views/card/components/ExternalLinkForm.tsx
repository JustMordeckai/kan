import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";
import { HiXMark } from "react-icons/hi2";

import Button from "~/components/Button";
import Input from "~/components/Input";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { getCardExternalUrlError } from "~/utils/cardExternalLink";
import { invalidateCard } from "~/utils/cardInvalidation";

// Edits the card's own link, or with `sharedBoard` the card's link on a
// board it is shared with.
export function ExternalLinkForm({
  cardPublicId,
  externalUrl,
  sharedBoard,
}: {
  cardPublicId: string;
  externalUrl: string | null;
  sharedBoard?: { publicId: string; name: string };
}) {
  const { closeModal } = useModal();
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const [value, setValue] = useState(externalUrl ?? "");
  const [showError, setShowError] = useState(false);

  useEffect(() => {
    document.querySelector<HTMLElement>("#card-external-url")?.focus();
  }, []);

  const mutationOptions = {
    onSuccess: () => {
      closeModal();
    },
    onError: () => {
      showPopup({
        header: t`Unable to update link`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
    onSettled: async () => {
      await Promise.all([
        invalidateCard(utils, cardPublicId),
        utils.board.byId.invalidate(),
      ]);
    },
  };
  const updateCardLink = api.card.update.useMutation(mutationOptions);
  const updateSharedBoardLink =
    api.card.updateSharedBoard.useMutation(mutationOptions);
  const isPending = updateCardLink.isPending || updateSharedBoardLink.isPending;

  const updateLink = (next: string | null) => {
    if (sharedBoard)
      updateSharedBoardLink.mutate({
        cardPublicId,
        boardPublicId: sharedBoard.publicId,
        externalUrl: next,
      });
    else updateCardLink.mutate({ cardPublicId, externalUrl: next });
  };

  const sharedBoardName = sharedBoard?.name;
  const heading = sharedBoardName
    ? externalUrl
      ? t`Edit external link on ${sharedBoardName}`
      : t`Add external link on ${sharedBoardName}`
    : externalUrl
      ? t`Edit external link`
      : t`Add external link`;

  const trimmed = value.trim();
  const error = trimmed ? getCardExternalUrlError(trimmed) : null;
  const errorMessage =
    error === "tooLong"
      ? t`The link is too long.`
      : error
        ? t`Enter a link starting with https://`
        : undefined;

  const save = () => {
    setShowError(true);
    if (error) return;

    const next = trimmed || null;
    if (next === externalUrl) {
      closeModal();
      return;
    }

    updateLink(next);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="px-5 pt-5">
        <div className="flex w-full items-center justify-between pb-4">
          <h2 className="text-sm font-bold text-neutral-900 dark:text-dark-1000">
            {heading}
          </h2>
          <button
            type="button"
            className="rounded p-1 hover:bg-light-200 focus:outline-none dark:hover:bg-dark-300"
            onClick={(e) => {
              e.preventDefault();
              closeModal();
            }}
          >
            <HiXMark size={18} className="text-light-900 dark:text-dark-900" />
          </button>
        </div>

        <label
          htmlFor="card-external-url"
          className="mb-2 block text-xs font-medium text-light-900 dark:text-dark-900"
        >
          {t`Link (for example a Discord thread)`}
        </label>
        <Input
          id="card-external-url"
          // Plain text so our own message replaces the browser's validation.
          type="text"
          inputMode="url"
          autoComplete="off"
          placeholder="https://discord.com/channels/..."
          value={value}
          onChange={(e) => setValue(e.target.value)}
          errorMessage={showError ? errorMessage : undefined}
        />
      </div>
      <div className="mt-12 flex items-center justify-between gap-2 border-t border-light-600 px-5 pb-5 pt-5 dark:border-dark-600">
        <div>
          {externalUrl && (
            <Button
              type="button"
              variant="secondary"
              disabled={isPending}
              onClick={() => updateLink(null)}
            >
              {t`Remove link`}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => closeModal()}
          >
            {t`Cancel`}
          </Button>
          <Button
            type="submit"
            isLoading={isPending}
            disabled={isPending || (!trimmed && !externalUrl)}
          >
            {t`Save`}
          </Button>
        </div>
      </div>
    </form>
  );
}
