import PocketBase from "pocketbase";
import { Dealer } from "../types";

// Initialize PocketBase
// In production (served by PB), this is relative. In dev, it might need to be localhost:8090
const PB_URL = import.meta.env.VITE_POCKETBASE_URL || "/";
export const pb = new PocketBase(PB_URL);

export const COLLECTION_NAME = "dealers";

// --- Data Access Functions ---

/**
 * Gets a list of all dealers from PocketBase.
 * @returns A promise resolving to an array of Dealer objects.
 */
export const getAllDealers = async (): Promise<Dealer[]> => {
  try {
    const records = await pb.collection(COLLECTION_NAME).getFullList({
      sort: "name",
    });

    return records.map((record) => {
      // Check if there is an uploaded file
      const logoUrl =
        record.logo && !record.logo.startsWith("http")
          ? pb.files.getURL(record, record.logo)
          : record.logo;

      return {
        id: record.id,
        name: record.name,
        logo: logoUrl,
        code: record.code,
      };
    });
  } catch (error) {
    console.error("Error fetching dealers from PocketBase:", error);
    return [];
  }
};

/**
 * Finds a dealer by their 4-digit code (e.g., "0000", "1111").
 * @param dealerCode The 4-digit code of the dealer.
 * @returns A promise resolving to the Dealer object or undefined if not found.
 */
export const findDealer = async (
  dealerCode: string
): Promise<Dealer | undefined> => {
  try {
    // Search for dealer by code field instead of ID
    const record = await pb
      .collection(COLLECTION_NAME)
      .getFirstListItem(`code="${dealerCode}"`);
    const logoUrl =
      record.logo && !record.logo.startsWith("http")
        ? pb.files.getURL(record, record.logo)
        : record.logo;

    return {
      id: record.id,
      name: record.name,
      logo: logoUrl,
      code: record.code,
    };
  } catch (error) {
    // PocketBase throws 404 if not found
    return undefined;
  }
};

/**
 * Gets a list of dealers for display (e.g., in the admin panel).
 * Excludes the Admin user if it exists as a special record (or handle logic here).
 * @returns A promise resolving to an array of Dealer objects.
 */
export const getDealers = async (): Promise<Dealer[]> => {
  const dealers = await getAllDealers();
  // Filter out any specific admin record if necessary.
  // Assuming standard dealers for now.
  return dealers.sort((a, b) => a.name.localeCompare(b.name));
};

// --- Data Mutation Functions ---

export const addDealer = async (
  dealer: Omit<Dealer, "id">
): Promise<Dealer> => {
  try {
    const record = await pb.collection(COLLECTION_NAME).create(dealer);
    const logoUrl =
      record.logo && !record.logo.startsWith("http")
        ? pb.files.getURL(record, record.logo)
        : record.logo;

    return {
      id: record.id,
      name: record.name,
      logo: logoUrl,
      code: record.code,
    };
  } catch (error) {
    console.error("Error adding dealer:", error);
    throw error;
  }
};

export const updateDealer = async (dealer: Dealer): Promise<Dealer> => {
  try {
    const record = await pb.collection(COLLECTION_NAME).update(dealer.id, {
      name: dealer.name,
      logo: dealer.logo,
    });
    const logoUrl =
      record.logo && !record.logo.startsWith("http")
        ? pb.files.getURL(record, record.logo)
        : record.logo;

    return {
      id: record.id,
      name: record.name,
      logo: logoUrl,
      code: record.code,
    };
  } catch (error) {
    console.error("Error updating dealer:", error);
    throw error;
  }
};

/**
 * Creates a new dealer with support for file uploads.
 * @param formData The FormData object containing dealer data.
 * @returns A promise resolving to the newly created Dealer object.
 */
export const addDealerWithFile = async (
  formData: FormData
): Promise<Dealer> => {
  try {
    const record = await pb.collection(COLLECTION_NAME).create(formData);

    const logoUrl =
      record.logo && !record.logo.startsWith("http")
        ? pb.files.getURL(record, record.logo)
        : record.logo;

    return {
      id: record.id,
      name: record.name,
      logo: logoUrl,
      code: record.code,
    };
  } catch (error) {
    console.error("Error adding dealer with file:", error);
    throw error;
  }
};

export const deleteDealer = async (dealerId: string): Promise<void> => {
  try {
    await pb.collection(COLLECTION_NAME).delete(dealerId);
  } catch (error) {
    console.error("Error deleting dealer:", error);
    throw error;
  }
};
