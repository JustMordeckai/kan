import { t } from "@lingui/core/macro";
import { useEffect, useState } from "react";

import Button from "~/components/Button";
import Input from "~/components/Input";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

const parseRoleIds = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  ),
];

export function DiscordRolesForm({
  boardPublicId,
  discordRoleIds,
  canEdit,
}: {
  boardPublicId: string;
  discordRoleIds: string[];
  canEdit: boolean;
}) {
  const { showPopup } = usePopup();
  const utils = api.useUtils();
  const savedValue = discordRoleIds.join(", ");
  const [value, setValue] = useState(savedValue);

  useEffect(() => setValue(savedValue), [savedValue]);

  const roleIds = parseRoleIds(value);
  const isValid = roleIds.every((id) => /^[0-9]{1,20}$/.test(id));

  const updateBoard = api.board.update.useMutation({
    onSuccess: async () => {
      await utils.board.discordRoles.invalidate({ boardPublicId });
      showPopup({
        header: t`Discord roles saved`,
        message: t`Board members will be updated at the next sync.`,
        icon: "success",
      });
    },
    onError: (error) => {
      showPopup({
        header: t`Unable to save Discord roles`,
        message: error.message,
        icon: "error",
      });
    },
  });

  const handleSave = () => {
    if (!isValid) return;
    updateBoard.mutate({
      boardPublicId,
      discordRoleIds: roleIds.length ? roleIds : null,
    });
  };

  return (
    <div className="mb-8">
      <label
        htmlFor="discord-role-ids"
        className="mb-2 block text-sm font-medium text-neutral-900 dark:text-dark-1000"
      >
        {t`Discord roles (ids)`}
      </label>
      <p className="mb-3 text-xs text-light-900 dark:text-dark-900">
        {t`Comma-separated Discord role ids. When set, members holding one of these roles are added to the board and members without them are removed. Leave empty to manage members by hand.`}
      </p>
      <div className="flex items-start gap-2">
        <Input
          id="discord-role-ids"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={!canEdit}
          placeholder="123456789012345678, 234567890123456789"
          errorMessage={
            isValid ? undefined : t`Role ids can only contain digits`
          }
        />
        {canEdit && (
          <Button
            onClick={handleSave}
            isLoading={updateBoard.isPending}
            disabled={!isValid || value === savedValue}
          >
            {t`Save`}
          </Button>
        )}
      </div>
    </div>
  );
}
