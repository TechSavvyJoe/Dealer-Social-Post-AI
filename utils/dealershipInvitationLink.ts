/** Parse a private link without ever navigating to user-supplied destinations. */
export function dealershipInvitationToken(
  value: string,
  origin: string,
): string | null {
  if (value.length > 2048) return null;
  try {
    const url = new URL(value.trim(), origin);
    if (
      url.origin !== origin ||
      url.pathname !== "/join" ||
      url.search ||
      url.username ||
      url.password ||
      !/^#[a-f0-9]{64}$/.test(url.hash)
    )
      return null;
    return url.hash.slice(1);
  } catch {
    return null;
  }
}
