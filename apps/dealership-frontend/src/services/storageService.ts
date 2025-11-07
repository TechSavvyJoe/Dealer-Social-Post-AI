import { SavedSale, Salesperson } from '../types';
import { STORAGE_KEYS } from '../config/constants';
import { storage } from '../lib/utils';

const DEFAULT_SALESPEOPLE: Salesperson[] = [
  { id: 'sp_1', name: 'Alice Smith' },
  { id: 'sp_2', name: 'Bob Johnson' },
  { id: 'sp_3', name: 'Charlie Brown' },
];

/**
 * Initialize salespeople with default data
 */
const initializeSalespeople = (): Salesperson[] => {
  try {
    storage.set(STORAGE_KEYS.SALESPEOPLE, DEFAULT_SALESPEOPLE);
    return DEFAULT_SALESPEOPLE;
  } catch (error) {
    console.error('Failed to initialize salespeople', error);
    return [];
  }
};

/**
 * Get all salespeople
 */
export function getSalespeople(): Salesperson[] {
  try {
    const salespeople = storage.get<Salesperson[]>(STORAGE_KEYS.SALESPEOPLE);
    if (salespeople && salespeople.length > 0) {
      return salespeople;
    }
    return initializeSalespeople();
  } catch (error) {
    console.error('Failed to retrieve salespeople', error);
    return [];
  }
}

/**
 * Add a new salesperson
 */
export function addSalesperson(name: string): Salesperson[] {
  const salespeople = getSalespeople();
  const newSalesperson: Salesperson = {
    id: `sp_${Date.now()}`,
    name,
  };
  const updated = [...salespeople, newSalesperson];
  storage.set(STORAGE_KEYS.SALESPEOPLE, updated);
  return updated;
}

/**
 * Get all saved sales
 */
export function getAllSales(): SavedSale[] {
  try {
    const sales = storage.get<SavedSale[]>(STORAGE_KEYS.SALES, []);
    // Sort by date, newest first
    return sales.sort((a, b) => b.id - a.id);
  } catch (error) {
    console.error('Failed to retrieve sales from localStorage', error);
    return [];
  }
}

/**
 * Get sales for a specific salesperson by ID or name
 */
export function getSalesForPerson(salespersonIdOrName: string): SavedSale[] {
  const allSales = getAllSales();
  return allSales.filter((sale) =>
    sale.salespersonId === salespersonIdOrName ||
    sale.salespersonName === salespersonIdOrName
  );
}

/**
 * Save a new sale
 */
export function saveSale(sale: SavedSale): SavedSale[] {
  const existingSales = getAllSales();
  // Prepend new sale to keep the list sorted by newest first
  const updatedSales = [sale, ...existingSales];
  try {
    storage.set(STORAGE_KEYS.SALES, updatedSales);
    return updatedSales;
  } catch (error) {
    console.error('Failed to save sale to localStorage', error);
    // Return original list on failure
    return existingSales;
  }
}

/**
 * Delete a sale by ID
 */
export function deleteSale(saleId: number): SavedSale[] {
  const existingSales = getAllSales();
  const updatedSales = existingSales.filter((sale) => sale.id !== saleId);
  storage.set(STORAGE_KEYS.SALES, updatedSales);
  return updatedSales;
}

/**
 * Get a single sale by ID
 */
export function getSaleById(saleId: number): SavedSale | null {
  const sales = getAllSales();
  return sales.find((sale) => sale.id === saleId) || null;
}
