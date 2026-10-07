import React, { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";
import { connectionManager } from "../utils/connectionManager";

/**
 * Persistent connectivity strip. Lot Wi-Fi and LTE dead zones are normal for
 * this product, so going offline is stated calmly — and truthfully: session
 * and creative state genuinely persist on-device.
 */
export const OfflineBanner: React.FC = () => {
  const [online, setOnline] = useState(connectionManager.isOnline);

  useEffect(() => connectionManager.subscribe(setOnline), []);

  if (online) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-warning-ink/30 bg-warning-fill px-4 py-2 text-xs font-medium text-warning-ink"
    >
      <WifiOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      You're offline — your work is saved on this device and sharing resumes when you
      reconnect.
    </div>
  );
};
