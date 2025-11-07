import React, { useState, useMemo } from 'react';
import { SavedSale } from '../types';
import TranscriptSegmentView from './TranscriptSegmentView';
import { markdownToHtml } from '../utils/markdown';
import HistoryIcon from './icons/HistoryIcon';
import ChevronLeftIcon from './icons/ChevronLeftIcon';
import SortAscendingIcon from './icons/SortAscendingIcon';
import SortDescendingIcon from './icons/SortDescendingIcon';
import PerformanceReportView from './PerformanceReportView';

interface PastSalesViewProps {
    sales: SavedSale[];
}

const PastSalesView: React.FC<PastSalesViewProps> = ({ sales }) => {
    const [selectedSale, setSelectedSale] = useState<SavedSale | null>(null);
    const [activeTab, setActiveTab] = useState<'transcript' | 'summary' | 'analytics'>('transcript');
    const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');

    const sortedSales = useMemo(() => {
        const sortableSales = [...sales];
        sortableSales.sort((a, b) => {
            if (sortOrder === 'desc') {
                return b.id - a.id; // id is timestamp, so higher is newer
            } else {
                return a.id - b.id;
            }
        });
        return sortableSales;
    }, [sales, sortOrder]);

    const TabButton: React.FC<{ tab: 'transcript' | 'summary' | 'analytics', label: string, disabled?: boolean }> = ({ tab, label, disabled }) => (
        <button
            onClick={() => setActiveTab(tab)}
            disabled={disabled}
            className={`px-4 py-2 text-sm font-semibold rounded-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed
            ${activeTab === tab ? 'bg-blue-600 text-white' : 'bg-gray-700 hover:bg-gray-600 text-gray-300'}
            `}
        >
            {label}
        </button>
    );

    if (selectedSale) {
        return (
            <div className="w-full h-full max-w-4xl mx-auto flex flex-col bg-gray-800/50 border border-gray-700/50 rounded-2xl shadow-xl overflow-hidden">
                <div className="p-4 border-b border-gray-700/50 flex items-center justify-between shrink-0">
                    <div className="flex items-center">
                        <button onClick={() => setSelectedSale(null)} className="p-2 mr-2 rounded-full hover:bg-gray-700 transition-colors">
                            <ChevronLeftIcon className="w-6 h-6 text-gray-300" />
                        </button>
                        <div>
                            <h2 className="text-xl font-bold text-blue-300">Sale Details</h2>
                            <p className="text-sm text-gray-400">{selectedSale.date}</p>
                        </div>
                    </div>
                    <div className="text-right text-sm">
                        <p><span className="font-semibold text-gray-400">Salesperson:</span> {selectedSale.salespersonName}</p>
                        <p><span className="font-semibold text-gray-400">Customer:</span> {selectedSale.customerName}</p>
                    </div>
                </div>

                <div className="p-4 border-b border-gray-700/50 flex space-x-2 shrink-0">
                    <TabButton tab="transcript" label="Transcript" />
                    <TabButton tab="summary" label="Summary" />
                    <TabButton tab="analytics" label="Analytics" disabled={!selectedSale.performanceReport} />
                </div>
                
                <div className="flex-grow overflow-y-auto">
                    {activeTab === 'transcript' && (
                         <div className="p-6 space-y-4">
                            {selectedSale.transcript.map(segment => (
                                <TranscriptSegmentView key={segment.id} segment={segment} onUpdate={() => {}} isReadOnly />
                            ))}
                        </div>
                    )}
                    {activeTab === 'summary' && (
                        <div className="p-6">
                            <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(selectedSale.summary) }} />
                        </div>
                    )}
                    {activeTab === 'analytics' && selectedSale.performanceReport && (
                        <PerformanceReportView report={selectedSale.performanceReport} />
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="w-full max-w-4xl mx-auto">
             <div className="flex items-center justify-between gap-3 mb-6">
                <div className="flex items-center gap-3">
                    <HistoryIcon className="w-8 h-8 text-blue-400" />
                    <h2 className="text-3xl font-bold text-blue-400">Sales History</h2>
                </div>
                {sales.length > 0 && (
                    <button
                        onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-semibold rounded-lg transition-all duration-200 bg-gray-700 hover:bg-gray-600 text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900"
                    >
                        {sortOrder === 'desc' ? <SortDescendingIcon className="w-4 h-4" /> : <SortAscendingIcon className="w-4 h-4" />}
                        <span>Sort: {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
                    </button>
                )}
            </div>
            {sales.length === 0 ? (
                <div className="text-center text-gray-500 py-20">
                    <p>No past sales recordings found.</p>
                    <p className="text-sm">Completed recordings will appear here.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {sortedSales.map(sale => (
                        <div key={sale.id} onClick={() => setSelectedSale(sale)} className="bg-gray-800/50 border border-gray-700/50 rounded-lg p-4 cursor-pointer hover:bg-gray-700/50 transition-colors">
                            <div className="flex justify-between items-center">
                                <div>
                                    <p className="font-semibold text-lg text-gray-200">
                                        Sale with {sale.customerName}
                                    </p>
                                    <p className="text-sm text-gray-400">
                                        Handled by <span className="font-medium text-blue-300">{sale.salespersonName}</span> on {sale.date}
                                    </p>
                                </div>
                                <ChevronLeftIcon className="w-6 h-6 text-gray-500 transform rotate-180" />
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default PastSalesView;
