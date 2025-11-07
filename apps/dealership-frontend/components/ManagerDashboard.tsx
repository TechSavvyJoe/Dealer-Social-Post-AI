import React, { useState, useEffect } from 'react';
import { getSalespeople } from '../services/storageService';
import { Salesperson, LiveCallData, SaleStatus } from '../types';
import { getLiveCallData } from '../services/realtimeService';
import Card from './common/Card';
import UsersIcon from './icons/UsersIcon';
import RecordingIcon from './icons/RecordingIcon';
import ProgressCircle from './common/ProgressCircle';
import AnalyticsIcon from './icons/AnalyticsIcon';

interface ManagerDashboardProps {
  onSelectCall: (data: LiveCallData) => void;
  onShowAnalytics: () => void;
}

const ManagerDashboard: React.FC<ManagerDashboardProps> = ({ onSelectCall, onShowAnalytics }) => {
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [liveCallData, setLiveCallData] = useState<LiveCallData | null>(null);

  useEffect(() => {
    setSalespeople(getSalespeople());
    setLiveCallData(getLiveCallData());

    const handleStorageChange = () => {
      setLiveCallData(getLiveCallData());
    };

    window.addEventListener('storage', handleStorageChange);
    // Also listen to our custom event for same-tab updates if needed
    window.addEventListener('storageCleared', handleStorageChange);


    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('storageCleared', handleStorageChange);
    };
  }, []);

  const getSalespersonStatus = (salespersonId: string) => {
    if (liveCallData?.salespersonId === salespersonId && liveCallData.status === SaleStatus.LIVE) {
      return { status: SaleStatus.LIVE, data: liveCallData };
    }
    return { status: SaleStatus.IDLE, data: null };
  };

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-4">
          <UsersIcon className="w-8 h-8 text-indigo-400" />
          <h1 className="text-4xl font-bold text-indigo-300">Sales Team Dashboard</h1>
        </div>
        <button
            onClick={onShowAnalytics}
            className="flex items-center gap-2 px-4 py-2 font-semibold text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 transition-colors"
        >
            <AnalyticsIcon className="w-5 h-5"/>
            View Analytics
        </button>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {salespeople.map(sp => {
          const { status, data } = getSalespersonStatus(sp.id);
          const isLive = status === SaleStatus.LIVE;
          const probability = data?.dashboardData?.saleSuccessProbability;

          return (
            <Card key={sp.id} className={`p-6 flex flex-col ${isLive ? 'border-green-500/70' : ''}`}>
              <div className="flex-grow flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-white">{sp.name}</h2>
                  <div className={`flex items-center gap-2 mt-2 text-sm font-medium ${isLive ? 'text-green-400' : 'text-gray-400'}`}>
                    {isLive && <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span></span>}
                    <span>{isLive ? 'Live Call in Progress' : 'Idle'}</span>
                  </div>
                </div>
                {isLive && typeof probability === 'number' && (
                    <div className="text-center">
                        <ProgressCircle progress={probability} />
                        <p className="text-xs font-semibold text-gray-400 mt-2">Success Probability</p>
                    </div>
                )}
              </div>
              <div className="mt-6">
                  {isLive && data ? (
                    <button
                      onClick={() => onSelectCall(data)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <RecordingIcon className="w-5 h-5"/>
                      Monitor Call
                    </button>
                  ) : (
                    <button
                      disabled
                      className="w-full px-4 py-2 font-semibold text-gray-500 bg-gray-700/50 rounded-lg cursor-not-allowed"
                    >
                      View History
                    </button>
                  )}
                </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ManagerDashboard;
