import { Dealer } from '../types';

// The URL for the published Google Sheet CSV
const GOOGLE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQaktKL9GNnSxsKVdAZchbrRItir0R6PYO5pQdWmP6qmlq-aRNLRHt_-bO1OFIi_f-1pS81Uj3P_UZF/pub?output=csv';

let cachedDealers: Dealer[] | null = null;
let dealersPromise: Promise<Dealer[]> | null = null;

/**
 * Parses CSV text into an array of Dealer objects.
 * @param csvText The raw CSV string.
 * @returns An array of Dealer objects.
 */
const parseCsv = (csvText: string): Dealer[] => {
    const lines = csvText.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const header = lines[0].split(',').map(h => h.trim());
    const dealers: Dealer[] = [];

    const idIndex = header.indexOf('dealer_id');
    const nameIndex = header.indexOf('dealership_name');
    const logoIndex = header.indexOf('logo_url');

    if (idIndex === -1 || nameIndex === -1 || logoIndex === -1) {
        console.error('CSV header is missing one of required columns: dealer_id, dealership_name, logo_url');
        return [];
    }

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        const values = line.split(','); // Simple split, assumes no commas in names

        const id = values[idIndex]?.trim();
        const name = values[nameIndex]?.trim();
        const logo = values[logoIndex]?.trim();
        
        if (id && name) {
            dealers.push({
                id,
                name,
                logo: logo || undefined,
            });
        }
    }
    
    // Add the static Admin user, which might not be in the sheet, if it doesn't already exist.
    if (!dealers.some(d => d.id === '0000')) {
      dealers.push({ id: '0000', name: 'Admin Control' });
    }

    return dealers;
};

/**
 * Fetches and caches the list of dealers from the Google Sheet.
 * Ensures the fetch operation is only performed once.
 * @returns A promise that resolves to an array of Dealer objects.
 */
const fetchAndCacheDealers = (): Promise<Dealer[]> => {
    if (dealersPromise) {
        return dealersPromise;
    }

    dealersPromise = new Promise(async (resolve, reject) => {
        try {
            // Use no-cache to ensure we get the latest sheet version on app load
            const response = await fetch(GOOGLE_SHEET_URL, { cache: 'no-store' });
            if (!response.ok) {
                throw new Error(`Network response was not ok: ${response.statusText}`);
            }
            const csvText = await response.text();
            const dealers = parseCsv(csvText);
            cachedDealers = dealers;
            resolve(dealers);
        } catch (error) {
            console.error('Error fetching or parsing dealers:', error);
            reject(new Error('Could not load dealer list from the source.'));
        }
    });

    return dealersPromise;
};

/**
 * Gets the list of all dealers, fetching from the source if necessary.
 * @returns A promise resolving to an array of all dealers.
 */
const getAllDealers = async (): Promise<Dealer[]> => {
    return cachedDealers ? cachedDealers : await fetchAndCacheDealers();
};

// --- Data Access Functions ---

/**
 * Finds a dealer by their ID.
 * @param dealerId The 4-digit ID of the dealer.
 * @returns A promise resolving to the Dealer object or undefined if not found.
 */
export const findDealer = async (dealerId: string): Promise<Dealer | undefined> => {
    const dealers = await getAllDealers();
    const cleanedId = dealerId.trim();
    return dealers.find(dealer => dealer.id === cleanedId);
};

/**
 * Gets a list of dealers for display (e.g., in the admin panel).
 * Excludes the Admin user.
 * @returns A promise resolving to an array of Dealer objects.
 */
export const getDealers = async (): Promise<Dealer[]> => {
    const dealers = await getAllDealers();
    // Return all dealers except the admin one, sorted by name
    return dealers
        .filter(d => d.id !== '0000')
        .sort((a, b) => a.name.localeCompare(b.name));
};

// --- Data Mutation Functions (Read-Only) ---

const readOnlyError = () => {
    throw new Error('This action is disabled. The app is connected to a read-only Google Sheet database.');
};

export const addDealer = (dealer: Dealer): Dealer => {
    readOnlyError();
    // @ts-ignore
    return;
};

export const updateDealer = (dealer: Dealer): Dealer => {
    readOnlyError();
    // @ts-ignore
    return;
};

export const deleteDealer = (dealerId: string): void => {
    readOnlyError();
};