import Head from "next/head";

import { useBranding } from "~/hooks/useBranding";
import { brandTitle } from "~/utils/branding";

export const PageHead = ({ title }: { title: string }) => {
  const branding = useBranding();

  return (
    <Head>
      <title>{brandTitle(title, branding)}</title>
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1, maximum-scale=1"
      />
      <link rel="manifest" href="/manifest.json" />
    </Head>
  );
};
