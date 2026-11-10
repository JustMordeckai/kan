import { t } from "@lingui/core/macro";
import { FaDiscord } from "react-icons/fa";
import { HiOutlineLink } from "react-icons/hi2";

import { parseCardExternalLink } from "~/utils/cardExternalLink";

// Opens the card's external link (e.g. its Discord thread) in a new tab.
export function ExternalLinkButton({
  externalUrl,
}: {
  externalUrl: string | null | undefined;
}) {
  const link = parseCardExternalLink(externalUrl);

  if (!link) return null;

  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      title={link.url}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border-[1px] border-light-600 bg-light-50 px-2.5 py-1 text-xs font-medium text-light-1000 shadow-sm hover:bg-light-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-light-700 dark:border-dark-600 dark:bg-dark-300 dark:text-dark-1000 dark:hover:bg-dark-400 dark:focus-visible:ring-dark-700"
    >
      {link.isDiscord ? (
        <>
          <FaDiscord className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t`Open in Discord`}</span>
        </>
      ) : (
        <>
          <HiOutlineLink className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="shrink-0">{t`Open link`}</span>
          <span className="truncate text-light-800 dark:text-dark-800">
            {link.hostname}
          </span>
        </>
      )}
    </a>
  );
}
