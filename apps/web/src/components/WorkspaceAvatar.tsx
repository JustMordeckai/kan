import Image from "next/image";
import { twMerge } from "tailwind-merge";

const sizeMap = {
  xs: 20,
  sm: 24,
  lg: 64,
} as const;

/**
 * Workspace badge: the workspace image when one is set, otherwise the first
 * letter of the workspace name.
 */
export default function WorkspaceAvatar({
  name,
  imageUrl,
  size = "sm",
}: {
  name: string;
  imageUrl?: string | null;
  size?: keyof typeof sizeMap;
}) {
  const shapeClassName = twMerge(
    size === "xs" && "h-5 w-5 flex-shrink-0 rounded-[5px]",
    size === "sm" && "h-6 w-6 rounded-md",
    size === "lg" && "h-16 w-16 rounded-lg",
  );

  if (imageUrl) {
    return (
      <Image
        src={imageUrl}
        alt=""
        width={sizeMap[size]}
        height={sizeMap[size]}
        className={twMerge("object-cover", shapeClassName)}
      />
    );
  }

  return (
    <span
      className={twMerge(
        "inline-flex items-center justify-center bg-indigo-700",
        shapeClassName,
      )}
    >
      <span
        className={twMerge(
          "text-xs font-bold leading-none text-white",
          size === "xs" && "font-medium",
          size === "lg" && "text-2xl",
        )}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    </span>
  );
}
