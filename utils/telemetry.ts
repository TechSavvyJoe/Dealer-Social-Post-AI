type TelemetryLevel = "info" | "warn" | "error";

interface TelemetryEvent {
  id: string;
  level: TelemetryLevel;
  name: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

const TELEMETRY_STORAGE_KEY = "dealer-social-post-ai.telemetry";
const REDACTED_VALUE = "[REDACTED]";
const REDACTED_VIN = "[REDACTED_VIN]";
const CIRCULAR_VALUE = "[CIRCULAR]";
const TRUNCATED_VALUE = "[TRUNCATED]";
const UNSUPPORTED_VALUE = "[UNSUPPORTED]";
const MAX_SANITIZE_DEPTH = 10;

// VINs exclude I, O, and Q. Explicit non-VIN boundaries also catch values
// beside underscores, where a regular `\b` boundary would miss them.
const VIN_LIKE_PATTERN =
  /(^|[^A-HJ-NPR-Z0-9])([A-HJ-NPR-Z0-9]{17})(?=$|[^A-HJ-NPR-Z0-9])/gi;

const redactVinLikeStrings = (value: string) =>
  value.replace(
    VIN_LIKE_PATTERN,
    (match, prefix: string, candidate: string) => {
      // Real VINs contain numeric positions. Requiring a digit prevents ordinary
      // 17-letter identifiers (for example, property names) from being mangled.
      if (!/\d/.test(candidate)) return match;
      return `${prefix}${REDACTED_VIN}`;
    },
  );

const isSensitiveTelemetryKey = (key: string) => {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  if (
    normalized === "vin" ||
    normalized.endsWith("vehiclevin") ||
    normalized.endsWith("attachedvin")
  ) {
    return true;
  }

  if (
    normalized === "code" ||
    normalized.endsWith("dealercode") ||
    normalized.endsWith("admincode") ||
    normalized.endsWith("accesscode") ||
    normalized.endsWith("invitecode")
  ) {
    return true;
  }

  return (
    normalized.includes("authorization") ||
    normalized.includes("cookie") ||
    normalized.includes("token") ||
    normalized.includes("signature") ||
    normalized.includes("password") ||
    normalized.includes("secret") ||
    normalized.includes("credential") ||
    normalized.endsWith("apikey")
  );
};

const sanitizeValue = (
  value: unknown,
  key: string | undefined,
  depth: number,
  ancestors: WeakSet<object>,
): unknown => {
  if (key && isSensitiveTelemetryKey(key)) return REDACTED_VALUE;
  if (typeof value === "string") return redactVinLikeStrings(value);
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return value;
  }
  if (typeof value === "bigint") {
    return redactVinLikeStrings(String(value));
  }
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return UNSUPPORTED_VALUE;
  }
  if (depth >= MAX_SANITIZE_DEPTH) return TRUNCATED_VALUE;

  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: redactVinLikeStrings(value.name),
      message: redactVinLikeStrings(value.message),
    };
  }

  if (typeof value !== "object") return UNSUPPORTED_VALUE;
  if (ancestors.has(value)) return CIRCULAR_VALUE;
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) =>
        sanitizeValue(entry, undefined, depth + 1, ancestors),
      );
    }

    const sanitized: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const property of Object.keys(value)) {
      const safeProperty = redactVinLikeStrings(property);
      try {
        sanitized[safeProperty] = sanitizeValue(
          (value as Record<string, unknown>)[property],
          property,
          depth + 1,
          ancestors,
        );
      } catch {
        sanitized[safeProperty] = UNSUPPORTED_VALUE;
      }
    }
    return sanitized;
  } finally {
    ancestors.delete(value);
  }
};

/**
 * Returns a detached, JSON-safe copy suitable for every telemetry sink.
 * Sensitive fields are removed by key and VIN-like values are removed from all
 * strings (including nested arrays, errors, and property names).
 */
export const sanitizeTelemetryPayload = (payload: unknown): unknown => {
  try {
    return sanitizeValue(payload, undefined, 0, new WeakSet<object>());
  } catch {
    return UNSUPPORTED_VALUE;
  }
};

const sanitizeTelemetryEvent = (event: TelemetryEvent): TelemetryEvent => {
  const sanitizedPayload = event.payload
    ? sanitizeTelemetryPayload(event.payload)
    : undefined;

  return {
    id: redactVinLikeStrings(event.id),
    level: event.level,
    name: redactVinLikeStrings(event.name),
    payload:
      sanitizedPayload &&
      typeof sanitizedPayload === "object" &&
      !Array.isArray(sanitizedPayload)
        ? (sanitizedPayload as Record<string, unknown>)
        : undefined,
    timestamp: event.timestamp,
  };
};

const isTelemetryEvent = (value: unknown): value is TelemetryEvent => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<TelemetryEvent>;
  return (
    typeof candidate.id === "string" &&
    (candidate.level === "info" ||
      candidate.level === "warn" ||
      candidate.level === "error") &&
    typeof candidate.name === "string" &&
    typeof candidate.timestamp === "number"
  );
};

const generateId = () =>
  `evt_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;

const getBuffer = (): TelemetryEvent[] => {
  if (typeof window === "undefined") return [];
  try {
    const cached = localStorage.getItem(TELEMETRY_STORAGE_KEY);
    if (!cached) return [];
    const parsed: unknown = JSON.parse(cached);
    if (!Array.isArray(parsed)) return [];
    const safeEvents = parsed
      .filter(isTelemetryEvent)
      .slice(-200)
      .map(sanitizeTelemetryEvent);
    const safeSerialized = JSON.stringify(safeEvents);
    if (safeSerialized !== cached) {
      localStorage.setItem(TELEMETRY_STORAGE_KEY, safeSerialized);
    }
    return safeEvents;
  } catch {
    return [];
  }
};

const persistBuffer = (events: TelemetryEvent[]) => {
  if (typeof window === "undefined") return;
  try {
    const safeEvents = events.slice(-200).map(sanitizeTelemetryEvent);
    localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(safeEvents));
  } catch {
    // Swallow storage failures; telemetry must never interrupt the workflow.
  }
};

const enqueue = (event: TelemetryEvent) => {
  const safeEvent = sanitizeTelemetryEvent(event);
  const buffer = getBuffer();
  buffer.push(safeEvent);
  persistBuffer(buffer);

  if (
    typeof navigator !== "undefined" &&
    typeof navigator.sendBeacon === "function"
  ) {
    try {
      navigator.sendBeacon("/api/telemetry", JSON.stringify(safeEvent));
    } catch {
      // Ignore beacon failures; the sanitized buffer persists locally.
    }
  }
};

const log = (
  level: TelemetryLevel,
  name: string,
  payload?: Record<string, unknown>,
) => {
  const safePayload = payload
    ? (sanitizeTelemetryPayload(payload) as Record<string, unknown>)
    : undefined;
  const event: TelemetryEvent = {
    id: generateId(),
    level,
    name: redactVinLikeStrings(name),
    payload: safePayload,
    timestamp: Date.now(),
  };

  enqueue(event);

  // Structured console output for local debugging, using the same redacted
  // payload sent to persistence and the network.
  const consolePayload = event.payload ? JSON.stringify(event.payload) : "";
  const message = `[telemetry:${level}] ${event.name}${
    consolePayload ? ` ${consolePayload}` : ""
  }`;
  // eslint-disable-next-line no-console
  console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](
    message,
  );
};

export const logEvent = (name: string, payload?: Record<string, unknown>) =>
  log("info", name, payload);
export const logWarning = (name: string, payload?: Record<string, unknown>) =>
  log("warn", name, payload);
export const logError = (name: string, payload?: Record<string, unknown>) =>
  log("error", name, payload);

export const getTelemetrySnapshot = () => getBuffer();
