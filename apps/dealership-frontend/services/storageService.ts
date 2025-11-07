import { SavedSale, Salesperson } from '../types';

const SALES_HISTORY_KEY = 'dealership-ai-sales-coach-history';
const SALESPEOPLE_KEY = 'dealership-ai-salespeople';

// Pre-populate with some demo data if none exists
const initializeSalespeople = (): Salesperson[] => {
    const defaultSalespeople: Salesperson[] = [
        { id: 'sp_1', name: 'Alice Smith' },
        { id: 'sp_2', name: 'Bob Johnson' },
        { id: 'sp_3', name: 'Charlie Brown' },
    ];
    try {
        localStorage.setItem(SALESPEOPLE_KEY, JSON.stringify(defaultSalespeople));
        return defaultSalespeople;
    } catch (error) {
        console.error("Failed to initialize salespeople", error);
        return [];
    }
};


export function getSalespeople(): Salesperson[] {
     try {
        const salespeopleJSON = localStorage.getItem(SALESPEOPLE_KEY);
        if (salespeopleJSON) {
            return JSON.parse(salespeopleJSON) as Salesperson[];
        }
        return initializeSalespeople();
    } catch (error) {
        console.error("Failed to retrieve salespeople", error);
        return [];
    }
}


export function getAllSales(): SavedSale[] {
    try {
        const savedSalesJSON = localStorage.getItem(SALES_HISTORY_KEY);
        if (savedSalesJSON) {
            const sales = JSON.parse(savedSalesJSON) as SavedSale[];
            // Sort by date, newest first
            return sales.sort((a, b) => b.id - a.id);
        }
        return [];
    } catch (error) {
        console.error("Failed to retrieve sales from localStorage", error);
        return [];
    }
}

export function saveSale(sale: SavedSale): SavedSale[] {
    const existingSales = getAllSales();
    // Prepend new sale to keep the list sorted by newest first
    const updatedSales = [sale, ...existingSales];
    try {
        localStorage.setItem(SALES_HISTORY_KEY, JSON.stringify(updatedSales));
        return updatedSales;
    } catch (error) {
        console.error("Failed to save sale to localStorage", error);
        // Return original list on failure
        return existingSales;
    }
}
