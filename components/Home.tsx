import React, { useCallback, useEffect, useRef, useState } from "react";
import { Images, LoaderCircle, Upload } from "lucide-react";
import type { BrandCategoryId, GeneratedPost, ImageSelection } from "../types";
import { useAppStore } from "../stores/appStore";
import { homeTilesForDealer, type HomeTile } from "../services/storeDefaults";
import { usePhotoIntake } from "../hooks/usePhotoIntake";
import { usePostHistoryList } from "../hooks/usePostHistoryList";
import { cn } from "../utils/classNames";
import { CategoryTiles } from "./home/CategoryTiles";
import { MyWorkPreview } from "./home/MyWorkPreview";
import { Button } from "./ui/Button";
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
  const libraryInputRef = useRef<HTMLInputElement | null>(null);
  const pageHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const waitingHeadingRef = useRef<HTMLHeadingElement | null>(null);
  // Set only when a photo arrives without a category in this visit (library or
  // drop), so a photo restored from the store never steals focus on mount.
  const focusWaitingPhotoRef = useRef(false);
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
        focusWaitingPhotoRef.current = true;
        setPendingPhoto(selection);
        setDroppedPhoto(selection);
      }
    },
  });

  const handleFile = useCallback(
    (file: File, tile: HomeTile) => {
      if (activeTileRef.current || intake.isProcessing) return;
      activeTileRef.current = tile;
      void intake.processFile(file).finally(() => {
        if (activeTileRef.current === tile) activeTileRef.current = null;
      });
    },
    [intake],
  );

  // The library photo has no category yet (no active tile: `handleFile` clears
  // it when its photo settles, and this row is disabled until then). It waits
  // on Home until the next tile tap assigns one, the same path a drop takes.
  const handleLibraryFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void intake.processFile(file);
  };

  useEffect(() => {
    if (pendingPhoto !== droppedPhoto) setDroppedPhoto(pendingPhoto);
  }, [droppedPhoto, pendingPhoto]);

  useEffect(() => {
    if (!droppedPhoto || !focusWaitingPhotoRef.current) return;
    focusWaitingPhotoRef.current = false;
    waitingHeadingRef.current?.focus();
  }, [droppedPhoto]);

  // A waiting photo turns every tile tap into "use this photo", so without
  // this a wrong library pick or drop could not be undone from Home. The card
  // (and its focused button) unmounts, so focus goes back to the page heading.
  const removeWaitingPhoto = () => {
    setPendingPhoto(null);
    setDroppedPhoto(null);
    pageHeadingRef.current?.focus();
  };

  const photoWaiting = Boolean(droppedPhoto);

  return (
    <div className="mx-auto w-full max-w-[1240px] px-4 pb-8 pt-4 sm:px-6 lg:grid lg:grid-cols-[minmax(0,1.65fr)_minmax(330px,.75fr)] lg:gap-10 lg:px-8 lg:pt-10 xl:gap-14">
      <section>
        <h1
          ref={pageHeadingRef}
          tabIndex={-1}
          className="font-display text-[28px] font-semibold leading-tight tracking-tight text-ink sm:text-4xl"
        >
          Your next great post.
        </h1>
        {/* Always mounted so the change is announced, not just shown. */}
        <div role="status">
          {intake.isProcessing ? (
            <p className="mt-2 flex items-center gap-2 text-base text-ink">
              <LoaderCircle
                className="h-4 w-4 motion-safe:animate-spin"
                aria-hidden="true"
              />
              Getting your photo ready…
            </p>
          ) : null}
        </div>
        {intake.isProcessing || photoWaiting ? null : (
          <p className="mt-1 text-sm leading-5 text-ink-2">
            A photo. A story. Ready to share.
          </p>
        )}

        {/* Keep existing-photo intake at the top on every device. */}
        <div className="mt-3">
          <input
            ref={libraryInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            aria-label="Choose a photo from your library"
            onChange={handleLibraryFile}
          />
          <Button
            variant="secondary"
            size="lg"
            fullWidth
            leftIcon={<Images />}
            disabled={intake.isProcessing}
            onClick={() => libraryInputRef.current?.click()}
            className="min-h-[52px] justify-start border-brand-ink bg-gradient-to-r from-brand-fill/60 to-brand-fill/35 px-4 text-base text-ink"
          >
            Choose from library
          </Button>
        </div>

        {intake.error ? (
          <ErrorBanner
            message={intake.error}
            onRetry={() => intake.setError(null)}
            actionLabel="Dismiss"
            className="mt-6"
          />
        ) : null}

        {droppedPhoto ? (
          <div className="mt-6 flex items-start gap-3 rounded-md border border-strong bg-panel-raised p-3">
            <img
              src={droppedPhoto.workingImage}
              alt="Your photo"
              className="h-20 w-20 shrink-0 rounded-sm border border-hairline object-cover"
            />
            <div className="min-w-0">
              <h2
                ref={waitingHeadingRef}
                tabIndex={-1}
                className="text-lg font-semibold text-ink"
              >
                Pick what this photo is for
              </h2>
              <p className="mt-0.5 text-sm text-ink-2">
                Tap a category below to start the post.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={removeWaitingPhoto}
                className="-ml-2 mt-1 min-h-11 px-2"
              >
                Remove photo
              </Button>
            </div>
          </div>
        ) : null}

        <div className="mt-3">
          <CategoryTiles
            tiles={tiles}
            usualCategory={person?.defaultCategory}
            disabled={intake.isProcessing}
            photoWaiting={photoWaiting}
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

        <p
          className={cn(
            "mt-6 hidden items-center gap-2 text-sm md:flex",
            intake.isDraggingOver ? "text-ink" : "text-ink-hint",
          )}
        >
          {intake.isDraggingOver ? (
            <Upload className="h-4 w-4" aria-hidden="true" />
          ) : null}
          {intake.isDraggingOver
            ? "Drop the photo now."
            : "Or drop a photo anywhere on this page."}
        </p>
      </section>

      <div className="mt-3 border-t border-hairline pt-1 lg:mt-1 lg:border-0 lg:pt-0">
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
