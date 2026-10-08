import React, { useEffect, useState } from "react";
import {
  getPublicVehicleSpin,
  loadSpinFrames,
  type VehicleSpin,
} from "../services/vehicleSpins";
import { useSpinFrameUrls } from "../hooks/useSpinFrameUrls";
import { toUiMessage } from "../utils/errorMessages";
import { VehicleSpinViewer } from "./VehicleSpinViewer";

export const PublicVehicleSpin: React.FC<{ token: string }> = ({ token }) => {
  const [spin, setSpin] = useState<VehicleSpin | null>(null);
  const [frames, setFrames] = useState<Blob[]>([]);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const urls = useSpinFrameUrls(frames);
  useEffect(() => {
    const controller = new AbortController();
    setSpin(null);
    setFrames([]);
    setProgress(0);
    setError("");
    const load = async () => {
      try {
        const result = await getPublicVehicleSpin(token, controller.signal);
        const images = await loadSpinFrames(result, {
          signal: controller.signal,
          publicToken: token,
          onProgress: setProgress,
        });
        if (!controller.signal.aborted) {
          setSpin(result);
          setFrames(images);
          document.title = result.vehicle.title + " | " + result.dealerName;
        }
      } catch (reason) {
        if (!controller.signal.aborted)
          setError(toUiMessage(reason, "This vehicle view is unavailable."));
      }
    };
    void load();
    return () => controller.abort();
  }, [token]);
  return (
    <main className="h-full overflow-y-auto bg-canvas p-4 text-ink sm:p-8">
      <div className="mx-auto w-full max-w-5xl">
        {error ? (
          <div role="alert" className="rounded-lg border border-strong bg-panel p-6">
            <h1 className="text-2xl font-semibold">Vehicle view unavailable</h1>
            <p className="mt-3 text-ink-2">{error}</p>
          </div>
        ) : !spin ? (
          <p role="status" className="p-8 text-center text-ink-2">
            Opening vehicle view… {Math.round(progress * 100)}%
          </p>
        ) : (
          <>
            <p className="text-sm text-ink-2">{spin.dealerName}</p>
            <h1 className="mb-5 mt-2 text-2xl font-semibold tracking-tight sm:text-4xl">
              {spin.vehicle.title}
            </h1>
            <VehicleSpinViewer frames={urls} title={spin.vehicle.title} />
            <dl className="mt-5 grid grid-cols-2 gap-4 rounded-lg border border-strong bg-panel p-4">
              {spin.vehicle.mileage && (
                <div>
                  <dt className="text-sm text-ink-2">Mileage</dt>
                  <dd className="mt-1 font-semibold">{spin.vehicle.mileage} miles</dd>
                </div>
              )}
              {spin.vehicle.stock && (
                <div>
                  <dt className="text-sm text-ink-2">Stock</dt>
                  <dd className="mt-1 font-semibold">{spin.vehicle.stock}</dd>
                </div>
              )}
              {spin.vehicle.vin && (
                <div className="col-span-2">
                  <dt className="text-sm text-ink-2">VIN</dt>
                  <dd className="mt-1 break-all font-mono text-sm">
                    {spin.vehicle.vin}
                  </dd>
                </div>
              )}
            </dl>
            {spin.vehicle.highlights.length > 0 && (
              <ul className="mt-4 list-inside list-disc space-y-2 text-ink-2">
                {spin.vehicle.highlights.map((fact, i) => (
                  <li key={i}>{fact}</li>
                ))}
              </ul>
            )}
            <p className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-ink-2">
              {spin.vehicle.caption}
            </p>
          </>
        )}
      </div>
    </main>
  );
};
