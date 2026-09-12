/**
 * The signed-in salesperson's name, published by the app store the same way
 * `authBoundary` publishes the auth epoch, so a service module can mask it
 * out of the customer-identity guard without importing the store. A
 * salesperson may be named in prose ("Ask for Joe") but is never the
 * celebrated customer — the in-service caption gate, the browser guard and
 * the server all apply that same split.
 */
let activeSalespersonName = "";

export const setActiveSalespersonName = (name: string | undefined | null): void => {
  activeSalespersonName = (name || "").trim();
};

export const activeSalespersonPhrases = (): string[] =>
  activeSalespersonName ? [activeSalespersonName] : [];
