import { t } from "@lingui/core/macro";
import { HiCheckCircle, HiOutlineCheckCircle } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { invalidateCard } from "~/utils/cardInvalidation";

interface CardCompletionToggleProps {
  cardPublicId: string;
  completed: boolean;
  disabled?: boolean;
}

export function CardCompletionToggle({
  cardPublicId,
  completed,
  disabled = false,
}: CardCompletionToggleProps) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();

  const updateCompletion = api.card.update.useMutation({
    onMutate: async (update) => {
      await utils.card.byId.cancel({ cardPublicId });
      const previousCard = utils.card.byId.getData({ cardPublicId });

      utils.card.byId.setData({ cardPublicId }, (oldCard) => {
        if (!oldCard || update.completed === undefined) return oldCard;
        return { ...oldCard, completed: update.completed };
      });

      return { previousCard };
    },
    onError: (_error, _update, context) => {
      utils.card.byId.setData({ cardPublicId }, context?.previousCard);
      showPopup({
        header: t`Unable to update card status`,
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
  });

  const label = completed
    ? t`Mark card as incomplete`
    : t`Mark card as complete`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || updateCompletion.isPending}
      onClick={() => {
        updateCompletion.mutate({ cardPublicId, completed: !completed });
      }}
      className={twMerge(
        "mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-light-700 transition-colors dark:text-dark-700",
        !disabled &&
          "hover:bg-light-200 hover:text-green-600 dark:hover:bg-dark-200 dark:hover:text-green-400",
        completed && "text-green-600 dark:text-green-400",
        disabled && "cursor-default",
      )}
    >
      {completed ? (
        <HiCheckCircle className="h-5 w-5" />
      ) : (
        <HiOutlineCheckCircle className="h-5 w-5" />
      )}
    </button>
  );
}
