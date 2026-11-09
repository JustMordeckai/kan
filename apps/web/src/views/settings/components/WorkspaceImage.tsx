import { t } from "@lingui/core/macro";
import { env } from "next-runtime-env";
import { useCallback, useRef, useState } from "react";
import ReactCrop from "react-image-crop";

import "react-image-crop/dist/ReactCrop.css";

import Button from "~/components/Button";
import Modal from "~/components/modal";
import WorkspaceAvatar from "~/components/WorkspaceAvatar";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";

interface PercentCrop {
  unit: "%";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LocalPixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface ReactCropProps {
  crop: PercentCrop | undefined;
  onChange: (crop: LocalPixelCrop, percentCrop: PercentCrop) => void;
  aspect?: number;
  className?: string;
  children: React.ReactNode;
}

const AnyReactCrop = ReactCrop as unknown as React.FC<ReactCropProps>;

export default function WorkspaceImage({
  workspacePublicId,
  workspaceName,
  workspaceImage,
  disabled = false,
}: {
  workspacePublicId: string;
  workspaceName: string;
  workspaceImage: string | null;
  disabled?: boolean;
}) {
  const utils = api.useUtils();
  const { showPopup } = usePopup();
  const [uploading, setUploading] = useState(false);
  const [cropDialogOpen, setCropDialogOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedPreviewUrl, setSelectedPreviewUrl] = useState<string | null>(
    null,
  );
  const [crop, setCrop] = useState<PercentCrop>();
  const imgRef = useRef<HTMLImageElement | null>(null);

  const removeImage = api.workspace.removeImage.useMutation({
    onSuccess: async () => {
      showPopup({
        header: t`Workspace image removed`,
        message: t`Your workspace image has been removed.`,
        icon: "success",
      });
      await utils.workspace.all.refetch();
    },
    onError: () => {
      showPopup({
        header: t`Error removing workspace image`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
  });

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    event.preventDefault();
    const file = event.target.files?.[0] ?? null;
    // Allow picking the same file again after cancelling the crop
    event.target.value = "";
    if (!file || !workspacePublicId) {
      return showPopup({
        header: t`Error uploading workspace image`,
        message: t`Please select a file to upload.`,
        icon: "error",
      });
    }
    setSelectedFile(file);
    setSelectedPreviewUrl(URL.createObjectURL(file));
    setCropDialogOpen(true);
  };

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { naturalWidth, naturalHeight } = e.currentTarget;
      // Centered square crop at ~90% of the smaller dimension
      let widthPercent: number;
      let heightPercent: number;
      if (naturalWidth >= naturalHeight) {
        heightPercent = 90;
        widthPercent = (naturalHeight / naturalWidth) * heightPercent;
      } else {
        widthPercent = 90;
        heightPercent = (naturalWidth / naturalHeight) * widthPercent;
      }
      const x = (100 - widthPercent) / 2;
      const y = (100 - heightPercent) / 2;
      setCrop({ unit: "%", x, y, width: widthPercent, height: heightPercent });
    },
    [],
  );

  const getCroppedBlob = useCallback(async (): Promise<Blob> => {
    if (!imgRef.current || !crop) throw new Error("No crop to save");
    const image = imgRef.current;

    const canvas = document.createElement("canvas");
    const cropXpx = (crop.x / 100) * image.naturalWidth;
    const cropYpx = (crop.y / 100) * image.naturalHeight;
    const cropWpx = (crop.width / 100) * image.naturalWidth;
    const cropHpx = (crop.height / 100) * image.naturalHeight;

    // Same cap as user avatars: the image is displayed at 64x64 at most
    const maxSize = 512;
    const scale = Math.min(maxSize / cropWpx, maxSize / cropHpx, 1);
    canvas.width = Math.max(1, Math.floor(cropWpx * scale));
    canvas.height = Math.max(1, Math.floor(cropHpx * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas not supported");

    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(
      image,
      cropXpx,
      cropYpx,
      cropWpx,
      cropHpx,
      0,
      0,
      canvas.width,
      canvas.height,
    );

    const mime = selectedFile?.type ?? "image/jpeg";
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
        mime,
        0.85,
      );
    });
  }, [crop, selectedFile]);

  const resetCropState = useCallback(() => {
    setCrop(undefined);
    setSelectedFile(null);
    if (selectedPreviewUrl) URL.revokeObjectURL(selectedPreviewUrl);
    setSelectedPreviewUrl(null);
  }, [selectedPreviewUrl]);

  const handleCancelCrop = useCallback(() => {
    setCropDialogOpen(false);
    resetCropState();
  }, [resetCropState]);

  const handleSaveCrop = useCallback(async () => {
    try {
      if (!workspacePublicId || !selectedFile) return;
      setUploading(true);
      const blob = await getCroppedBlob();

      const originalExt = selectedFile.name.split(".").pop() ?? "jpg";
      const fileName = `workspace.${originalExt}`;

      const baseUrl = env("NEXT_PUBLIC_BASE_URL") ?? "";
      const response = await fetch(
        `${baseUrl}/api/upload/workspace-avatar?workspacePublicId=${encodeURIComponent(workspacePublicId)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": blob.type,
            "x-original-filename": encodeURIComponent(fileName),
          },
          body: blob,
        },
      );

      if (!response.ok) {
        throw new Error("Failed to upload workspace image");
      }

      // The workspace image is updated in the backend, refresh workspaces
      await utils.workspace.all.refetch();

      showPopup({
        header: t`Workspace image updated`,
        message: t`Your workspace image has been updated.`,
        icon: "success",
      });

      setCropDialogOpen(false);
      resetCropState();
    } catch (error) {
      console.error(error);
      showPopup({
        header: t`Error uploading workspace image`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    } finally {
      setUploading(false);
    }
  }, [
    getCroppedBlob,
    resetCropState,
    selectedFile,
    showPopup,
    utils.workspace.all,
    workspacePublicId,
  ]);

  return (
    <div className="flex items-center gap-4">
      <div className="relative h-16 w-16">
        {!disabled && (
          <input
            className="absolute z-10 h-16 w-16 cursor-pointer rounded-lg opacity-0"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label={t`Upload workspace image`}
            onChange={onFileChange}
            disabled={uploading}
          />
        )}
        <WorkspaceAvatar
          name={workspaceName}
          imageUrl={workspaceImage}
          size="lg"
        />
      </div>

      {workspaceImage && !disabled && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => removeImage.mutate({ workspacePublicId })}
          disabled={removeImage.isPending}
          isLoading={removeImage.isPending}
        >
          {t`Remove image`}
        </Button>
      )}

      {cropDialogOpen && (
        <Modal modalSize="md" positionFromTop="sm" isVisible>
          <div className="p-4 sm:p-6">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-light-1000 dark:text-dark-1000">
                {t`Crop your workspace image`}
              </h3>
              <p className="mt-1 text-sm text-light-800 dark:text-dark-800">
                {t`Adjust the square crop to fit your workspace image.`}
              </p>
            </div>
            <div className="max-h-[80vh]">
              <div className="flex justify-center rounded-md border border-light-600 p-2 dark:border-dark-600">
                <AnyReactCrop
                  crop={crop}
                  onChange={(_crop: LocalPixelCrop, percentCrop: PercentCrop) =>
                    setCrop(percentCrop)
                  }
                  aspect={1}
                  className="max-h-[50vh]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    ref={imgRef}
                    src={selectedPreviewUrl ?? undefined}
                    alt={t`Workspace image to crop`}
                    onLoad={onImageLoad}
                    className="h-auto w-auto"
                  />
                </AnyReactCrop>
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={handleCancelCrop}
                disabled={uploading}
              >
                {t`Cancel`}
              </Button>
              <Button onClick={handleSaveCrop} isLoading={uploading}>
                {t`Save`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
