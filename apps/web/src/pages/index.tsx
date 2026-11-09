import { useRouter } from "next/navigation";
import { env } from "next-runtime-env";
import { useEffect } from "react";

import HomeView from "~/views/home";

export default function Home() {
  const router = useRouter();
  const isCloud = env("NEXT_PUBLIC_KAN_ENV") === "cloud";

  // The middleware only redirects full page loads; client-side links to "/" (sidebar and auth logos) land here.
  useEffect(() => {
    if (!isCloud) router.replace("/boards");
  }, [isCloud, router]);

  if (!isCloud) return null;

  return <HomeView />;
}
