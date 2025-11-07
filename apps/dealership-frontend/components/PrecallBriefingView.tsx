import React, { useState } from 'react';
import Modal from './common/Modal';
import { getPrecallBriefing } from '../services/geminiService';
import { markdownToHtml } from '../utils/markdown';
import SparklesIcon from './icons/SparklesIcon';

interface PrecallBriefingViewProps {
  isOpen: boolean;
  onClose: () => void;
}

const InputField: React.FC<{ label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
    <div>
        <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
        <input
            type="text"
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
        />
    </div>
);

const PrecallBriefingView: React.FC<PrecallBriefingViewProps> = ({ isOpen, onClose }) => {
    const [customerInfo, setCustomerInfo] = useState({ name: '', vehicle: '', budget: '', tradeIn: '', notes: '' });
    const [briefing, setBriefing] = useState('');
    const [isLoading, setIsLoading] = useState(false);

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, field: string) => {
        setCustomerInfo(prev => ({ ...prev, [field]: e.target.value }));
    };

    const handleGenerateBriefing = async () => {
        setIsLoading(true);
        setBriefing('');
        const result = await getPrecallBriefing(customerInfo);
        setBriefing(result);
        setIsLoading(false);
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Pre-call Strategy Briefing">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Left side: Form */}
                <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-200">Customer Details</h3>
                    <InputField label="Customer Name" value={customerInfo.name} onChange={(e) => handleInputChange(e, 'name')} placeholder="e.g., Jane Doe" />
                    <InputField label="Vehicle of Interest" value={customerInfo.vehicle} onChange={(e) => handleInputChange(e, 'vehicle')} placeholder="e.g., 2024 SUV XL" />
                    <InputField label="Budget" value={customerInfo.budget} onChange={(e) => handleInputChange(e, 'budget')} placeholder="e.g., ~$40,000" />
                    <InputField label="Trade-In" value={customerInfo.tradeIn} onChange={(e) => handleInputChange(e, 'tradeIn')} placeholder="e.g., 2018 Sedan" />
                     <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">Additional Notes</label>
                        <textarea
                            value={customerInfo.notes}
                            onChange={(e) => handleInputChange(e, 'notes')}
                            placeholder="e.g., Needs good safety features for family"
                            rows={3}
                            className="w-full bg-gray-900/50 border border-gray-600 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
                        />
                    </div>
                    <button
                        onClick={handleGenerateBriefing}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-2 px-4 py-2 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-800 disabled:cursor-not-allowed"
                    >
                       {isLoading ? 'Generating...' : <><SparklesIcon className="w-5 h-5"/> Generate Briefing</>}
                    </button>
                </div>
                {/* Right side: Briefing */}
                <div className="bg-gray-900/30 p-4 rounded-lg border border-gray-700 h-[450px] overflow-y-auto">
                     <h3 className="text-lg font-semibold text-gray-200 mb-2">AI Generated Briefing</h3>
                     {isLoading && <p className="text-gray-400 animate-pulse">Generating your strategic briefing...</p>}
                     {briefing ? (
                         <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{__html: markdownToHtml(briefing)}} />
                     ) : (
                         !isLoading && <p className="text-gray-500">Your briefing will appear here.</p>
                     )}
                </div>
            </div>
        </Modal>
    );
};

export default PrecallBriefingView;
