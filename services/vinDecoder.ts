/**
 * NHTSA VIN decoder.
 *
 * Uses the free NHTSA vPIC API — no API key required.
 * Docs: https://vpic.nhtsa.dot.gov/api/
 *
 * Returns a normalized DecodedVehicle suitable for injecting into the
 * generation prompt as vehicle context (year/make/model/trim/key equipment).
 */

export interface DecodedVehicle {
  vin: string;
  year?: string;
  make?: string;
  model?: string;
  trim?: string;
  bodyClass?: string;
  engineCylinders?: string;
  engineDisplacementL?: string;
  fuelType?: string;
  driveType?: string;
  transmissionStyle?: string;
  doors?: string;
  series?: string;
  vehicleType?: string;
  plantCountry?: string;
  /** Human-readable summary, e.g. "2023 Ford Bronco Big Bend 4dr SUV — 2.3L 4cyl AWD". */
  summary: string;
  /** True if NHTSA returned no useful data for this VIN. */
  empty: boolean;
}

const NHTSA_ENDPOINT = "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues";

const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i;

export const isValidVin = (vin: string): boolean => {
  if (!vin) return false;
  const cleaned = vin.replace(/\s+/g, "").toUpperCase();
  // I, O, Q are not valid in a VIN
  return VIN_REGEX.test(cleaned) && !/[IOQ]/.test(cleaned);
};

/**
 * Strips formatting and uppercases. Use before validation / API calls.
 */
export const normalizeVin = (raw: string): string =>
  raw.replace(/\s+/g, "").toUpperCase();

interface NhtsaRow {
  // NHTSA returns a flat object with a known set of keys; we only pull what we need.
  ModelYear?: string;
  Make?: string;
  Model?: string;
  Trim?: string;
  Trim2?: string;
  Series?: string;
  Series2?: string;
  BodyClass?: string;
  EngineCylinders?: string;
  DisplacementL?: string;
  FuelTypePrimary?: string;
  DriveType?: string;
  TransmissionStyle?: string;
  Doors?: string;
  VehicleType?: string;
  PlantCountry?: string;
  ErrorCode?: string;
  ErrorText?: string;
}

const emptyIfDash = (v?: string): string | undefined => {
  if (!v) return undefined;
  const trimmed = v.trim();
  if (!trimmed || trimmed === "Not Applicable" || trimmed === "0") return undefined;
  return trimmed;
};

const buildSummary = (d: Omit<DecodedVehicle, "summary" | "empty">): string => {
  const parts: string[] = [];
  if (d.year) parts.push(d.year);
  if (d.make) parts.push(d.make);
  if (d.model) parts.push(d.model);
  if (d.trim) parts.push(d.trim);

  const head = parts.join(" ");
  const tail: string[] = [];
  if (d.bodyClass) tail.push(d.bodyClass);

  const drivetrain: string[] = [];
  if (d.engineDisplacementL) drivetrain.push(`${d.engineDisplacementL}L`);
  if (d.engineCylinders) drivetrain.push(`${d.engineCylinders}cyl`);
  if (d.driveType) drivetrain.push(d.driveType);
  if (drivetrain.length) tail.push(drivetrain.join(" "));

  if (d.fuelType) tail.push(d.fuelType);

  if (!head) return "Unknown vehicle";
  return tail.length ? `${head} — ${tail.join(", ")}` : head;
};

/**
 * Decode a VIN via NHTSA vPIC. Always resolves (never throws on bad data); the
 * caller should inspect `empty` and `summary` to decide whether to use it.
 */
export const decodeVin = async (vin: string): Promise<DecodedVehicle> => {
  const cleaned = normalizeVin(vin);

  if (!isValidVin(cleaned)) {
    return {
      vin: cleaned,
      summary: "Invalid VIN",
      empty: true,
    };
  }

  const url = `${NHTSA_ENDPOINT}/${encodeURIComponent(cleaned)}?format=json`;
  let json: { Results?: NhtsaRow[] } | undefined;

  // 8s timeout. Use AbortSignal.timeout where available (Chrome 103+,
  // Safari 17.4+). Older iPads / Safari fall back to AbortController.
  const controller =
    typeof AbortController !== "undefined" ? new AbortController() : null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let signal: AbortSignal | undefined;
  if (
    typeof AbortSignal !== "undefined" &&
    typeof (AbortSignal as any).timeout === "function"
  ) {
    signal = (AbortSignal as any).timeout(8000);
  } else if (controller) {
    timeoutHandle = setTimeout(() => controller.abort(), 8000);
    signal = controller.signal;
  }

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!res.ok) {
      throw new Error(`NHTSA returned ${res.status}`);
    }
    json = await res.json();
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    return {
      vin: cleaned,
      summary: `Could not decode VIN (${
        err instanceof Error ? err.message : "network error"
      })`,
      empty: true,
    };
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }

  const row = json?.Results?.[0];
  if (!row) {
    return { vin: cleaned, summary: "No NHTSA record for this VIN", empty: true };
  }

  const decoded: Omit<DecodedVehicle, "summary" | "empty"> = {
    vin: cleaned,
    year: emptyIfDash(row.ModelYear),
    make: emptyIfDash(row.Make),
    model: emptyIfDash(row.Model),
    trim: emptyIfDash(row.Trim) ?? emptyIfDash(row.Trim2),
    series: emptyIfDash(row.Series) ?? emptyIfDash(row.Series2),
    bodyClass: emptyIfDash(row.BodyClass),
    engineCylinders: emptyIfDash(row.EngineCylinders),
    engineDisplacementL: emptyIfDash(row.DisplacementL),
    fuelType: emptyIfDash(row.FuelTypePrimary),
    driveType: emptyIfDash(row.DriveType),
    transmissionStyle: emptyIfDash(row.TransmissionStyle),
    doors: emptyIfDash(row.Doors),
    vehicleType: emptyIfDash(row.VehicleType),
    plantCountry: emptyIfDash(row.PlantCountry),
  };

  const summary = buildSummary(decoded);
  const empty = !decoded.year && !decoded.make && !decoded.model;

  return { ...decoded, summary, empty };
};

/**
 * Builds a short, prompt-ready paragraph describing the vehicle. Used by the
 * Gemini service to give the model concrete facts to anchor on.
 */
export const vehicleToCreativeBrief = (v: DecodedVehicle): string => {
  if (v.empty) return "";
  const facts: string[] = [];
  const head = [v.year, v.make, v.model, v.trim].filter(Boolean).join(" ");
  if (head) facts.push(`Vehicle: ${head}.`);
  if (v.bodyClass) facts.push(`Body style: ${v.bodyClass}.`);
  const powertrain: string[] = [];
  if (v.engineDisplacementL) powertrain.push(`${v.engineDisplacementL}L`);
  if (v.engineCylinders) powertrain.push(`${v.engineCylinders}-cylinder`);
  if (v.fuelType) powertrain.push(v.fuelType.toLowerCase());
  if (powertrain.length) facts.push(`Powertrain: ${powertrain.join(" ")}.`);
  if (v.driveType) facts.push(`Drive: ${v.driveType}.`);
  if (v.transmissionStyle) facts.push(`Transmission: ${v.transmissionStyle}.`);
  return facts.join(" ");
};
