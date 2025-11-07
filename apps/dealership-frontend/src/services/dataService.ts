import { pb } from './pocketbaseClient';

// Live Sales
export async function getLiveSales() {
  const result = await pb.collection('live_sales').getFullList({
    filter: 'status = "active"',
    expand: 'salesperson_id',
    sort: '-started_at',
  });
  console.log('[dataService] getLiveSales result:', result);
  return result;
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
  const result = await pb.collection('sales').getList(1, limit, {
    sort: '-created',
    expand: 'salesperson_id',
  });
  console.log('[dataService] getRecentSales result:', result);
  return result;
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
  const result = await pb.collection('salespeople').getFullList({
    expand: 'user_id',
  });
  console.log('[dataService] getSalespeople result:', result);
  return result;
}

export async function createSalesperson(data: {
  user_id: string;
  name: string;
  performance_metrics?: any;
}) {
  return pb.collection('salespeople').create(data);
}

// User Management
export async function getAllUsers() {
  try {
    console.log('[dataService] getAllUsers - Auth valid:', pb.authStore.isValid);
    console.log('[dataService] getAllUsers - Current user:', pb.authStore.model);
    console.log('[dataService] getAllUsers - User role:', pb.authStore.model?.role);
    
    const result = await pb.collection('users').getFullList({
      sort: '-created',
    });
    console.log('[dataService] getAllUsers result:', result);
    return result;
  } catch (error: any) {
    console.error('[dataService] getAllUsers error:', error);
    console.error('[dataService] Error details:', {
      message: error.message,
      status: error.status,
      response: error.response,
      data: error.data
    });
    throw error;
  }
}

export async function createUser(email: string, password: string, role: 'manager' | 'salesman', name?: string) {
  try {
    const result = await pb.collection('users').create({
      email,
      password,
      passwordConfirm: password,
      role,
      name: name || email.split('@')[0], // Use email prefix if no name provided
      emailVisibility: true,
    });
    console.log('[dataService] createUser success:', result);
    return result;
  } catch (error) {
    console.error('[dataService] createUser error:', error);
    throw error;
  }
}

export async function updateUser(id: string, email: string, role: 'manager' | 'salesman', name?: string) {
  try {
    const updateData: any = {
      email,
      role,
    };
    
    if (name !== undefined) {
      updateData.name = name;
    }
    
    const result = await pb.collection('users').update(id, updateData);
    console.log('[dataService] updateUser success:', result);
    return result;
  } catch (error) {
    console.error('[dataService] updateUser error:', error);
    throw error;
  }
}

export async function deleteUser(id: string) {
  try {
    const result = await pb.collection('users').delete(id);
    console.log('[dataService] deleteUser success for id:', id);
    return result;
  } catch (error) {
    console.error('[dataService] deleteUser error:', error);
    throw error;
  }
}
