type TelemetryLevel = 'info' | 'warn' | 'error';

interface TelemetryEvent {
  id: string;
  level: TelemetryLevel;
  name: string;
  payload?: Record<string, unknown>;
  timestamp: number;
}

const TELEMETRY_STORAGE_KEY = 'dealer-social-post-ai.telemetry';

const generateId = () => `evt_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;

const getBuffer = (): TelemetryEvent[] => {
  if (typeof window === 'undefined') return [];
  try {
    const cached = localStorage.getItem(TELEMETRY_STORAGE_KEY);
    return cached ? (JSON.parse(cached) as TelemetryEvent[]) : [];
  } catch {
    return [];
  }
};

const persistBuffer = (events: TelemetryEvent[]) => {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(events.slice(-200)));
  } catch {
    // swallow storage failures
  }
};

const enqueue = (event: TelemetryEvent) => {
  const buffer = getBuffer();
  buffer.push(event);
  persistBuffer(buffer);

  if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
    try {
      const payload = JSON.stringify(event);
      navigator.sendBeacon('/api/telemetry', payload);
    } catch {
      // ignore beacon failures; buffer persists locally
    }
  }
};

const log = (level: TelemetryLevel, name: string, payload?: Record<string, unknown>) => {
  const event: TelemetryEvent = {
    id: generateId(),
    level,
    name,
    payload,
    timestamp: Date.now(),
  };

  enqueue(event);

  // Structured console output for local debugging.
  const consolePayload = payload ? JSON.stringify(payload) : '';
  const message = `[telemetry:${level}] ${name}${consolePayload ? ` ${consolePayload}` : ''}`;
  // eslint-disable-next-line no-console
  console[level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'log'](message);
};

export const logEvent = (name: string, payload?: Record<string, unknown>) => log('info', name, payload);
export const logWarning = (name: string, payload?: Record<string, unknown>) => log('warn', name, payload);
export const logError = (name: string, payload?: Record<string, unknown>) => log('error', name, payload);

export const getTelemetrySnapshot = () => getBuffer();
