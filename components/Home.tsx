import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Sparkles, Upload } from "lucide-react";
import type { BrandCategoryId, GeneratedPost, ImageSelection } from "../types";
import { useAppStore } from "../stores/appStore";
import { homeTilesForDealer, type HomeTile } from "../services/storeDefaults";
import { usePhotoIntake } from "../hooks/usePhotoIntake";
import { usePostHistoryList } from "../hooks/usePostHistoryList";
import { CategoryTiles } from "./home/CategoryTiles";
import { MyWorkPreview } from "./home/MyWorkPreview";
import { ErrorBanner } from "./ui/ErrorBanner";

export interface HomeProps {
  onPhotoPicked: (
    selection: ImageSelection,
    categoryId: BrandCategoryId,
    scenarioId: string,
  ) => void;
  onShowHistory: () => void;
  onOpenPost: (post: GeneratedPost) => void;
}

export const Home: React.FC<HomeProps> = ({
  onPhotoPicked,
  onShowHistory,
  onOpenPost,
}) => {
  const dealer = useAppStore((state) => state.currentDealer);
  const person = useAppStore((state) => state.currentPerson);
  const pendingPhoto = useAppStore((state) => state.pendingPhoto);
  const setPendingPhoto = useAppStore((state) => state.setPendingPhoto);
  const activeTileRef = useRef<HomeTile | null>(null);
  const [droppedPhoto, setDroppedPhoto] = useState<ImageSelection | null>(pendingPhoto);
  const tiles = homeTilesForDealer(dealer);
  const {
    filtered: posts,
    loading,
    error,
    openingId,
    load,
    openCreative,
  } = usePostHistoryList({ onPostReady: onOpenPost });

  const intake = usePhotoIntake({
    flattenToJpeg: true,
    enableDrop: true,
    onImageSelected: (selection) => {
      const activeTile = activeTileRef.current;
      if (activeTile) {
        onPhotoPicked(selection, activeTile.categoryId, activeTile.scenarioId);
        activeTileRef.current = null;
      } else {
        setPendingPhoto(selection);
        setDroppedPhoto(selection);
      }
    },
  });

  const handleFile = useCallback(
    (file: File, tile: HomeTile) => {
      activeTileRef.current = tile;
      void intake.processFile(file).finally(() => {
        if (activeTileRef.current === tile) activeTileRef.current = null;
      });
    },
    [intake],
  );

  useEffect(() => {
    if (pendingPhoto !== droppedPhoto) setDroppedPhoto(pendingPhoto);
  }, [droppedPhoto, pendingPhoto]);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-12 pt-5 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1.65fr)_minmax(330px,.75fr)] lg:gap-10 lg:px-8 lg:pt-10 xl:gap-14">
      <section>
        <div className="flex items-start gap-3 sm:gap-4">
          <span className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-md border border-strong bg-brand-tint text-brand-ink sm:h-12 sm:w-12">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
          </span>
          <div>
            <p className="mb-1 text-2xs font-semibold uppercase tracking-[0.16em] text-brand-ink">
              Create a post
            </p>
            <h1 className="font-display text-3xl font-semibold text-ink sm:text-4xl">
              What are you posting?
            </h1>
            <p className="mt-2 text-base text-ink-2 md:hidden">
              Pick one and the camera opens.
            </p>
            <p className="mt-2 hidden text-base text-ink-2 md:block">
              Pick one, then take or choose the photo.
            </p>
          </div>
        </div>

        {intake.error ? (
          <ErrorBanner
            message={intake.error}
            onRetry={() => intake.setError(null)}
            className="mt-5"
          />
        ) : null}

        {droppedPhoto ? (
          <div className="mt-7 overflow-hidden rounded-lg border border-strong bg-panel-raised">
            <div className="h-1 bg-brand-fill" aria-hidden="true" />
            <div className="flex items-center gap-3">
              <img
                src={droppedPhoto.workingImage}
                alt="Selected"
                className="m-3 h-20 w-20 rounded-md border border-hairline object-cover"
              />
              <div className="py-3 pr-4">
                <p className="text-2xs font-semibold uppercase tracking-[0.12em] text-brand-ink">
                  Photo ready
                </p>
                <h2 className="font-semibold text-ink">Pick what this photo is for</h2>
                <p className="mt-0.5 text-sm text-ink-2">
                  We&apos;ll use this image for the category you choose.
                </p>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-2">
              Choose a category
            </p>
            <span className="hidden text-xs text-ink-hint sm:inline">
              Photo first · AI next
            </span>
          </div>
          <CategoryTiles
            tiles={tiles}
            usualCategory={person?.defaultCategory}
            disabled={intake.isProcessing}
            onFile={handleFile}
            onSelect={(tile) => {
              if (!droppedPhoto) return false;
              onPhotoPicked(droppedPhoto, tile.categoryId, tile.scenarioId);
              setPendingPhoto(null);
              setDroppedPhoto(null);
              return true;
            }}
          />
        </div>
        <p className="mt-5 hidden items-center gap-2 text-sm text-ink-hint md:flex">
          {intake.isDraggingOver ? (
            <Upload className="h-4 w-4" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {intake.isDraggingOver
            ? "Drop the photo now."
            : "Or drop a photo anywhere on this page."}
        </p>
      </section>

      <div className="mt-12 lg:mt-1">
        <MyWorkPreview
          posts={posts}
          loading={loading}
          error={error}
          openingId={openingId}
          onSeeAll={onShowHistory}
          onRetry={() => void load()}
          onOpen={(post) => void openCreative(post)}
        />
      </div>
    </div>
  );
};
