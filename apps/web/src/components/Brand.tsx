import { useBranding } from "~/hooks/useBranding";

/**
 * Product name (and optional logo) of the instance, see `utils/branding.ts`.
 * Renders the plain default text when no branding is configured.
 */
export default function Brand() {
  const branding = useBranding();

  if (branding.isDefault) {
    // The attribute lets the runtime theme stylesheet hide the prerendered
    // default name until the configured one is rendered.
    return <span data-kan-brand="default">{branding.appName}</span>;
  }

  return (
    <span className="inline-flex items-center gap-2">
      {branding.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={branding.logoUrl}
          alt=""
          className="h-[1.25em] w-auto flex-shrink-0"
        />
      )}
      <span>{branding.appName}</span>
    </span>
  );
}
