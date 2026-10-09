import { withRequestDeadline } from "../utils/requestDeadline";

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
  VIN?: string;
  SuggestedVIN?: string;
}

const emptyIfDash = (v?: string): string | undefined => {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  if (
    !trimmed ||
    /^(?:not applicable|not available|unknown|n\/a|null|0|-+)$/i.test(trimmed)
  )
    return undefined;
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

/** Decode known manufacturer facts; caller cancellation propagates unchanged. */
export const decodeVin = async (
  vin: string,
  signal?: AbortSignal,
): Promise<DecodedVehicle> => {
  signal?.throwIfAborted();
  const cleaned = normalizeVin(vin);
  if (!isValidVin(cleaned))
    return { vin: cleaned, summary: "Invalid VIN", empty: true };
  const url = `${NHTSA_ENDPOINT}/${encodeURIComponent(cleaned)}?format=json`;
  let json: { Results?: NhtsaRow[] } | undefined;
  try {
    json = await withRequestDeadline(
      signal,
      async (requestSignal) => {
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: requestSignal,
        });
        if (!response.ok) throw new Error("Vehicle lookup is unavailable.");
        const result = await response.json();
        requestSignal.throwIfAborted();
        return result;
      },
      8000,
    );
    signal?.throwIfAborted();
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    return {
      vin: cleaned,
      summary: "Could not look up this VIN. Check your connection and try again.",
      empty: true,
    };
  }

  const row =
    Array.isArray(json?.Results) && json.Results.length === 1
      ? json.Results[0]
      : undefined;
  if (!row) {
    return { vin: cleaned, summary: "No NHTSA record for this VIN", empty: true };
  }

  // vPIC can decode partial/corrected VINs. Those facts must never be attached
  // to a different vehicle merely because the response includes a make/model.
  const errors =
    typeof row.ErrorCode === "string"
      ? row.ErrorCode.split(/[;,]/).map((code) => code.trim())
      : [];
  if (
    !errors.length ||
    errors.some((code) => code !== "0") ||
    (typeof row.VIN === "string" && normalizeVin(row.VIN) !== cleaned) ||
    (typeof row.SuggestedVIN === "string" && row.SuggestedVIN.trim())
  )
    return {
      vin: cleaned,
      summary:
        "This VIN could not be verified. Check all 17 characters on the vehicle and try again.",
      empty: true,
    };

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
