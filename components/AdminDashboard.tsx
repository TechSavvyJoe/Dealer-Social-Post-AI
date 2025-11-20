import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Dealer } from '../types';
import * as db from '../services/database';
import { Icon } from './Icons';
import { logEvent, logError } from '../utils/telemetry';
import { motion } from 'framer-motion';
import { Button } from './ui/Button';
import { Skeleton } from './ui/Skeleton';
import { RefreshCw } from 'lucide-react';

const DealerCard: React.FC<{ dealer: Dealer }> = ({ dealer }) => {
  return (
    <motion.div
      className="bg-white/5 border border-white/20 rounded-2xl p-4 sm:p-6 hover:border-primary-400/40 transition-all duration-200"
      whileHover={{ scale: 1.01, y: -2 }}
      whileTap={{ scale: 0.99 }}
    >
      <div className="flex justify-between items-start">
        <div className="flex items-center gap-4">
          {dealer.logo ? (
            <img src={dealer.logo} alt={`${dealer.name} Logo`} className="w-16 h-16 object-contain rounded-lg bg-white/10 p-1" />
          ) : (
            <div className="w-16 h-16 bg-indigo-900 rounded-lg flex items-center justify-center">
              <Icon type="building-office" className="w-8 h-8 text-indigo-400" />
            </div>
          )}
          <div>
            <h3 className="text-xl font-bold text-white">{dealer.name}</h3>
            <p className="text-sm text-slate-400">Code: {dealer.id}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <div className="p-2 text-slate-600" title="Editing disabled"><Icon type="edit" className="w-5 h-5" /></div>
          <div className="p-2 text-slate-600" title="Deleting disabled"><Icon type="trash" className="w-5 h-5" /></div>
        </div>
      </div>
    </motion.div>
  );
};


export const AdminDashboard: React.FC = () => {
  const { data, error, isPending, refetch } = useQuery({
    queryKey: ['dealers'],
    queryFn: async () => {
      try {
        const list = await db.getDealers();
        logEvent('admin.dealers.loaded', { count: list.length });
        return list;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        logError('admin.dealers.failed', { message });
        throw err;
      }
    },
  });

  const dealers = data ?? [];

  return (
    <div className="w-full max-w-4xl mx-auto p-2 sm:p-4 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h2 className="text-3xl sm:text-4xl font-bold text-white">Admin Dashboard</h2>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className="w-4 h-4" />}
            onClick={() => refetch()}
            disabled={isPending}
          >
            {isPending ? 'Refreshing…' : 'Refresh'}
          </Button>
          <Button
            variant="tinted"
            size="sm"
            disabled
            title="Adding is disabled; edit the Google Sheet directly."
          >
            <Icon type="plus" className="w-4 h-4" />
            <span className="hidden sm:inline">Add Dealer</span>
          </Button>
        </div>
      </div>

      <div className="text-center text-sm text-slate-400 bg-slate-800/50 p-3 rounded-lg">
        Admin functions are in read-only mode. This app is connected to a live Google Sheet.
        <br />
        To add, edit, or remove dealerships, please modify the sheet directly.
      </div>
      
      {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg flex items-center justify-center gap-2">
              <Icon type="error" className="w-5 h-5"/>
              <span>{error instanceof Error ? error.message : String(error)}</span>
              <button onClick={() => refetch()} className="ml-4 text-indigo-300 hover:text-white text-sm font-semibold underline">
                Retry
              </button>
          </div>
      )}

      {isPending ? (
        <div className="grid gap-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white/5 border border-white/10 rounded-2xl p-4 sm:p-6">
              <div className="flex items-center gap-4">
                <Skeleton className="w-16 h-16 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {dealers.map(dealer => (
            <DealerCard
              key={dealer.id}
              dealer={dealer}
            />
          ))}
           {dealers.length === 0 && !error && (
            <div className="text-center py-10 bg-white/5 border border-dashed border-white/20 rounded-2xl">
                <Icon type="building-office" className="w-12 h-12 mx-auto text-slate-500" />
                <p className="mt-4 text-slate-400">No dealerships found in the data source.</p>
                <p className="text-slate-500 text-sm">Check the connected Google Sheet.</p>
            </div>
           )}
        </div>
      )}
    </div>
  );
};
