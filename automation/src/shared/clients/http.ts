import { FatalError, ValidationError } from "@outputai/core";
import { HTTPError, TimeoutError } from "@outputai/http";

export function configuredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FatalError(`${name} is not configured`);
  }
  return value;
}

export async function mapProviderError(
  provider: string,
  error: unknown,
  ambiguousCreate = false,
): Promise<never> {
  if (error instanceof FatalError || error instanceof ValidationError) throw error;
  if (error instanceof HTTPError) {
    const status = error.response.status;
    const detail = (await error.response.text()).slice(0, 300);
    if (
      status === 400 ||
      status === 401 ||
      status === 403 ||
      status === 404 ||
      status === 422
    ) {
      throw new FatalError(`${provider} rejected the request (${status}): ${detail}`);
    }
    if (ambiguousCreate && status >= 500) {
      throw new FatalError(
        `${provider} create result is ambiguous and requires reconciliation (${status})`,
      );
    }
    throw new Error(`${provider} request failed (${status}): ${detail}`);
  }
  if (error instanceof TimeoutError) {
    if (ambiguousCreate)
      throw new FatalError(`${provider} create timed out and requires reconciliation`);
    throw new Error(`${provider} request timed out`);
  }
  if (ambiguousCreate)
    throw new FatalError(
      `${provider} create failed without a safe response and requires reconciliation`,
    );
  throw new Error(`${provider} request failed without a safe provider response`);
}
