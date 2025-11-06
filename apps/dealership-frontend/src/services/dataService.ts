import { pb } from './pocketbaseClient';

// Live Sales
export async function getLiveSales() {
  return pb.collection('live_sales').getFullList({
    filter: 'status = "active"',
    expand: 'salesperson_id',
    sort: '-started_at',
  });
}

export async function subscribeLiveSales(callback: (sales: any[]) => void) {
  await pb.collection('live_sales').subscribe('*', async () => {
    const sales = await getLiveSales();
    callback(sales);
  });

  // Also get initial data
  const initialSales = await getLiveSales();
  callback(initialSales);
}

export async function unsubscribeLiveSales() {
  pb.collection('live_sales').unsubscribe();
}

export async function startLiveSale(salespersonId: string, customerName: string) {
  return pb.collection('live_sales').create({
    salesperson_id: salespersonId,
    customer_name: customerName,
    status: 'active',
    started_at: new Date().toISOString(),
  });
}

export async function endLiveSale(id: string) {
  return pb.collection('live_sales').update(id, {
    status: 'ended',
    ended_at: new Date().toISOString(),
  });
}

// Sales
export async function getRecentSales(limit = 100) {
  return pb.collection('sales').getList(1, limit, {
    sort: '-created',
    expand: 'salesperson_id',
  });
}

export async function createSale(data: {
  salesperson_id: string;
  customer_name: string;
  transcript?: any;
  analysis?: any;
  performance_report?: any;
  success_probability?: number;
}) {
  return pb.collection('sales').create(data);
}

export async function getSaleById(id: string) {
  return pb.collection('sales').getOne(id, {
    expand: 'salesperson_id',
  });
}

// Salespeople
export async function getSalespeople() {
  return pb.collection('salespeople').getFullList({
    expand: 'user_id',
  });
}

export async function createSalesperson(data: {
  user_id: string;
  name: string;
  performance_metrics?: any;
}) {
  return pb.collection('salespeople').create(data);
}
