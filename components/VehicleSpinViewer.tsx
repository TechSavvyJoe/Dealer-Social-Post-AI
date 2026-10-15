import React, { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "./ui/Button";
import { spinFrameAt, spinZoom } from "../utils/vehicleSpin";

export interface VehicleSpinViewerProps {
  frames: string[];
  title: string;
  /** Changes for a new recording/project; background refinements keep it stable. */
  projectKey?: string | number;
  onAngleChange?: (index: number) => void;
  selectionLabel?: string;
  onSelectVehicle?: (point: { x: number; y: number }) => void;
}

export const VehicleSpinViewer: React.FC<VehicleSpinViewerProps> = ({
  frames,
  title,
  projectKey,
  onAngleChange,
  onSelectVehicle,
  selectionLabel = "Tap the middle of the vehicle to select it",
}) => {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({
    x: 0,
    y: 0,
    angle: 0,
    distance: 0,
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  const area = useRef<HTMLDivElement>(null);
  const picture = useRef<HTMLImageElement>(null);
  const angle = spinFrameAt(index, frames.length);
  const select = (next: number) => setIndex(spinFrameAt(next, frames.length));
  useEffect(() => {
    onAngleChange?.(angle);
  }, [angle, onAngleChange]);
  useEffect(() => {
    setIndex(0);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    pointers.current.clear();
  }, [frames.length, projectKey]);
  useEffect(() => {
    if (onSelectVehicle) {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  }, [Boolean(onSelectVehicle)]);
  useEffect(() => {
    const next = new Image();
    if (frames.length) next.src = frames[spinFrameAt(angle + 1, frames.length)];
    const previous = new Image();
    if (frames.length) previous.src = frames[spinFrameAt(angle - 1, frames.length)];
  }, [angle, frames]);
  const changeZoom = (value: number) => {
    const next = spinZoom(value);
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };
  useEffect(() => {
    const node = area.current;
    if (!node) return;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoom((current) => {
        const next = spinZoom(current + (event.deltaY < 0 ? 0.15 : -0.15));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => node.removeEventListener("wheel", wheel);
  }, []);
  const distance = () => {
    const [first, second] = [...pointers.current.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  };
  const startGesture = () => {
    const first = [...pointers.current.values()][0];
    if (first) gesture.current = { ...first, angle, distance: distance(), zoom, pan };
  };
  const endPointer = (event: React.PointerEvent) => {
    pointers.current.delete(event.pointerId);
    startGesture();
  };
  const stepAngle = (event: React.KeyboardEvent) => {
    if (
      ["ArrowLeft", "ArrowRight", "Home", "End", "+", "-", "Escape"].includes(event.key)
    )
      event.preventDefault();
    if (event.key === "ArrowLeft") select(angle - 1);
    if (event.key === "ArrowRight") select(angle + 1);
    if (event.key === "Home") select(0);
    if (event.key === "End") select(frames.length - 1);
    if (event.key === "+") changeZoom(zoom + 0.25);
    if (event.key === "-") changeZoom(zoom - 0.25);
    if (event.key === "Escape") changeZoom(1);
  };
  return (
    <section
      className="overflow-hidden rounded-lg border border-strong bg-panel"
      aria-label="Interactive vehicle view"
    >
      <div
        ref={area}
        tabIndex={0}
        role="group"
        aria-label={
          onSelectVehicle
            ? selectionLabel
            : "Vehicle spin. Arrow keys rotate. Plus and minus zoom."
        }
        className="relative flex aspect-8/5 touch-none items-center justify-center overflow-hidden bg-canvas -outline-offset-4"
        onKeyDown={stepAngle}
        onPointerDown={(event) => {
          if (onSelectVehicle) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          startGesture();
        }}
        onPointerMove={(event) => {
          if (!pointers.current.has(event.pointerId) || onSelectVehicle) return;
          pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          if (pointers.current.size > 1) {
            if (gesture.current.distance > 0)
              changeZoom(
                (gesture.current.zoom * distance()) / gesture.current.distance,
              );
          } else if (zoom > 1) {
            const bounds = area.current?.getBoundingClientRect();
            const maxX = ((bounds?.width || 0) * (zoom - 1)) / 2;
            const maxY = ((bounds?.height || 0) * (zoom - 1)) / 2;
            setPan({
              x: Math.max(
                -maxX,
                Math.min(
                  maxX,
                  gesture.current.pan.x + event.clientX - gesture.current.x,
                ),
              ),
              y: Math.max(
                -maxY,
                Math.min(
                  maxY,
                  gesture.current.pan.y + event.clientY - gesture.current.y,
                ),
              ),
            });
          } else {
            const width = area.current?.clientWidth || 320;
            select(
              gesture.current.angle -
                Math.round(
                  ((event.clientX - gesture.current.x) / width) * frames.length,
                ),
            );
          }
        }}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onLostPointerCapture={endPointer}
        onClick={(event) => {
          if (!onSelectVehicle || !picture.current) return;
          const bounds = picture.current.getBoundingClientRect();
          const image = picture.current;
          const scale = Math.min(
            bounds.width / image.naturalWidth,
            bounds.height / image.naturalHeight,
          );
          const width = image.naturalWidth * scale,
            height = image.naturalHeight * scale;
          const x = (event.clientX - bounds.left - (bounds.width - width) / 2) / width;
          const y =
            (event.clientY - bounds.top - (bounds.height - height) / 2) / height;
          if (x >= 0 && x <= 1 && y >= 0 && y <= 1) onSelectVehicle({ x, y });
        }}
      >
        {frames[angle] ? (
          <img
            ref={picture}
            src={frames[angle]}
            alt={title + ", angle " + (angle + 1) + " of " + frames.length}
            draggable={false}
            className="h-full w-full select-none object-contain"
            style={{
              transform:
                "translate(" + pan.x + "px, " + pan.y + "px) scale(" + zoom + ")",
            }}
          />
        ) : (
          <p className="p-5 text-sm text-ink-2">Your vehicle preview appears here.</p>
        )}
      </div>
      <div className="border-t border-hairline p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Previous angle"
              disabled={!frames.length}
              onClick={() => select(angle - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-14 text-center text-xs tabular-nums text-ink-2">
              {angle + 1} / {frames.length || "—"}
            </span>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Next angle"
              disabled={!frames.length}
              onClick={() => select(angle + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom out"
              disabled={zoom <= 1}
              onClick={() => changeZoom(zoom - 0.25)}
            >
              <ZoomOut />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Zoom in"
              disabled={zoom >= 3}
              onClick={() => changeZoom(zoom + 0.25)}
            >
              <ZoomIn />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Reset view"
              onClick={() => {
                changeZoom(1);
                select(0);
              }}
            >
              <RotateCcw />
            </Button>
          </div>
        </div>
        <input
          className="mt-1 min-h-11 w-full accent-brand-ink"
          type="range"
          min={0}
          max={Math.max(0, frames.length - 1)}
          value={angle}
          disabled={!frames.length}
          aria-label="View angle"
          onChange={(event) => select(Number(event.target.value))}
        />
        <p className="mt-1 text-center text-xs text-ink-2">
          {onSelectVehicle
            ? selectionLabel
            : zoom > 1
              ? "Drag to inspect • Zoom out to spin"
              : "Drag to spin • Pinch to zoom"}
        </p>
      </div>
    </section>
  );
};
