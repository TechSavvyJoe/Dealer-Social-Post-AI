import React, { useState, useMemo } from 'react';
import { SavedSale } from '../types';
import Card from './common/Card';
import BarChart from './common/BarChart';
import PerformanceReportView from './PerformanceReportView';
import Modal from './common/Modal';
import ChevronLeftIcon from './icons/ChevronLeftIcon';
import AnalyticsIcon from './icons/AnalyticsIcon';
import CalendarIcon from './icons/CalendarIcon';
import TrendingUpIcon from './icons/TrendingUpIcon';
import ChartPieIcon from './icons/ChartPieIcon';
import HistoryIcon from './icons/HistoryIcon';

interface ManagerAnalyticsViewProps {
  sales: SavedSale[];
  onExit: () => void;
}

const thirtyDaysAgo = new Date();
thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

const ManagerAnalyticsView: React.FC<ManagerAnalyticsViewProps> = ({ sales, onExit }) => {
  const [startDate, setStartDate] = useState(thirtyDaysAgo.toISOString().split('T')[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedSale, setSelectedSale] = useState<SavedSale | null>(null);

  const filteredSales = useMemo(() => {
    if (!sales) return [];
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    
    return sales.filter(sale => {
      const saleDate = new Date(sale.date);
      return saleDate >= start && saleDate <= end;
    }).sort((a, b) => b.id - a.id);
  }, [sales, startDate, endDate]);

  const analyticsData = useMemo(() => {
    const salesWithReports = filteredSales.filter(s => s.performanceReport);
    const salesWithProbability = filteredSales.filter(s => typeof s.saleSuccessProbability === 'number');

    const totalProbability = salesWithProbability.reduce((sum, sale) => sum + (sale.saleSuccessProbability || 0), 0);
    const averageSuccessProbability = salesWithProbability.length > 0 ? totalProbability / salesWithProbability.length : 0;
    
    const stepScores: { [key: string]: { total: number; count: number } } = {
        'Greeting': { total: 0, count: 0 },
        'Building a Profile': { total: 0, count: 0 },
        'Appraisal': { total: 0, count: 0 },
        'Selection & Demonstration': { total: 0, count: 0 },
        'Write Up & Presentation': { total: 0, count: 0 },
        'Delivery & Follow Up': { total: 0, count: 0 },
    };

    salesWithReports.forEach(sale => {
      sale.performanceReport?.stepByStepAnalysis.forEach(step => {
        if (stepScores[step.stepName]) {
          stepScores[step.stepName].total += step.score;
          stepScores[step.stepName].count++;
        }
      });
    });

    const averageStepScores = Object.entries(stepScores).map(([name, data]) => ({
      label: name,
      value: data.count > 0 ? data.total / data.count : 0,
    }));

    return {
      totalSales: filteredSales.length,
      averageSuccessProbability,
      averageStepScores,
    };
  }, [filteredSales]);

  return (
    <>
      <Modal 
        isOpen={!!selectedSale} 
        onClose={() => setSelectedSale(null)} 
        title={`Performance Report for Sale on ${selectedSale ? new Date(selectedSale.date).toLocaleDateString() : ''}`}
      >
        {selectedSale?.performanceReport ? (
            <div className="max-h-[70vh] overflow-y-auto">
                <PerformanceReportView report={selectedSale.performanceReport} />
            </div>
        ) : <p className="text-gray-400">No performance report available for this sale.</p>}
      </Modal>

      <div className="p-4 md:p-8 max-w-7xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-4">
                <AnalyticsIcon className="w-8 h-8 text-indigo-400" />
                <h1 className="text-4xl font-bold text-indigo-300">Performance Analytics</h1>
            </div>
            <button onClick={onExit} className="flex items-center gap-2 text-sm text-gray-300 hover:text-white font-semibold transition-colors bg-gray-700/50 px-4 py-2 rounded-lg">
                <ChevronLeftIcon className="w-5 h-5" />
                Back to Dashboard
            </button>
        </div>

        {/* Filters */}
        <Card className="p-4 mb-8">
            <div className="flex flex-col md:flex-row items-center gap-4">
                <h3 className="text-lg font-semibold text-gray-200 flex items-center gap-2">
                    <CalendarIcon className="w-5 h-5"/> Date Range
                </h3>
                <div className="flex items-center gap-2">
                    <input 
                        type="date" 
                        value={startDate}
                        onChange={e => setStartDate(e.target.value)}
                        className="bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white"
                    />
                    <span className="text-gray-400">to</span>
                    <input 
                        type="date" 
                        value={endDate}
                        onChange={e => setEndDate(e.target.value)}
                        className="bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-1.5 text-white"
                    />
                </div>
            </div>
        </Card>
        
        {/* KPI Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
             <Card className="p-6">
                <h3 className="text-lg font-semibold text-gray-400 flex items-center gap-2"><HistoryIcon className="w-5 h-5"/>Total Sales Recorded</h3>
                <p className="text-5xl font-bold text-blue-300 mt-2">{analyticsData.totalSales}</p>
            </Card>
             <Card className="p-6">
                <h3 className="text-lg font-semibold text-gray-400 flex items-center gap-2"><TrendingUpIcon className="w-5 h-5"/>Avg. Success Probability</h3>
                <p className="text-5xl font-bold text-green-300 mt-2">{analyticsData.averageSuccessProbability.toFixed(0)}%</p>
            </Card>
            <Card className="p-6">
                <h3 className="text-lg font-semibold text-gray-400 flex items-center gap-2"><ChartPieIcon className="w-5 h-5"/>Sales with Reports</h3>
                <p className="text-5xl font-bold text-indigo-300 mt-2">{filteredSales.filter(s=>s.performanceReport).length}</p>
            </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Sales List */}
            <div className="lg:col-span-2">
                <h2 className="text-2xl font-bold text-gray-200 mb-4">Sales in Period</h2>
                <Card className="p-4 max-h-[500px] overflow-y-auto">
                    {filteredSales.length > 0 ? (
                        <div className="space-y-3">
                            {filteredSales.map(sale => (
                                <div 
                                    key={sale.id} 
                                    onClick={() => sale.performanceReport && setSelectedSale(sale)}
                                    className={`p-3 rounded-lg transition-colors ${sale.performanceReport ? 'bg-gray-700/60 hover:bg-gray-700 cursor-pointer' : 'bg-gray-800/40 opacity-60'}`}
                                >
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="font-semibold text-white">{sale.customerName} w/ {sale.salespersonName}</p>
                                            <p className="text-xs text-gray-400">{new Date(sale.date).toLocaleString()}</p>
                                        </div>
                                        {typeof sale.saleSuccessProbability === 'number' && (
                                            <div className="text-right">
                                                <p className="font-bold text-lg text-green-400">{sale.saleSuccessProbability}%</p>
                                                <p className="text-xs text-gray-500">Success</p>
                                            </div>
                                        )}
                                    </div>
                                     {!sale.performanceReport && <p className="text-xs text-amber-400 mt-1">No detailed report available.</p>}
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-500 py-10">No sales recorded in this period.</p>
                    )}
                </Card>
            </div>

            {/* Step Analysis */}
            <div className="lg:col-span-3">
                 <h2 className="text-2xl font-bold text-gray-200 mb-4">Average Step Scores</h2>
                 <Card className="p-6">
                    {filteredSales.filter(s=>s.performanceReport).length > 0 ? (
                        <BarChart data={analyticsData.averageStepScores} maxValue={10} />
                    ) : (
                        <p className="text-center text-gray-500 py-10">No sales with performance reports in this period to analyze.</p>
                    )}
                </Card>
            </div>
        </div>
      </div>
    </>
  );
};

export default ManagerAnalyticsView;
