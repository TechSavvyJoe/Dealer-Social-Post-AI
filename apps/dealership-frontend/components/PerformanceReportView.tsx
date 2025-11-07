import React from 'react';
import { PerformanceReport, SalesStepAnalysis } from '../types';
import { markdownToHtml } from '../utils/markdown';
import Card from './common/Card';
import SparklesIcon from './icons/SparklesIcon';
import GreetingIcon from './icons/GreetingIcon';
import ProfileIcon from './icons/ProfileIcon';
import AppraisalIcon from './icons/AppraisalIcon';
import DemonstrationIcon from './icons/DemonstrationIcon';
import PresentationIcon from './icons/PresentationIcon';
import DeliveryIcon from './icons/DeliveryIcon';
import ThumbsUpIcon from './icons/ThumbsUpIcon';
import AlertTriangleIcon from './icons/AlertTriangleIcon';

interface PerformanceReportViewProps {
  report: PerformanceReport;
}

const stepIcons: { [key: string]: React.FC<React.SVGProps<SVGSVGElement>> } = {
    'Greeting': GreetingIcon,
    'Building a Profile': ProfileIcon,
    'Appraisal': AppraisalIcon,
    'Selection & Demonstration': DemonstrationIcon,
    'Write Up & Presentation': PresentationIcon,
    'Delivery & Follow Up': DeliveryIcon,
};

const ScoreIndicator: React.FC<{ score: number }> = ({ score }) => {
    const getColor = (s: number) => {
        if (s >= 8) return 'bg-green-500';
        if (s >= 5) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    return (
        <div className="flex items-center gap-2">
            <div className="w-24 bg-gray-700 rounded-full h-2.5">
                <div className={`${getColor(score)} h-2.5 rounded-full`} style={{ width: `${score * 10}%` }}></div>
            </div>
            <span className={`font-bold text-lg ${getColor(score).replace('bg', 'text')}`}>{score}/10</span>
        </div>
    );
};


const SalesStepCard: React.FC<{ analysis: SalesStepAnalysis }> = ({ analysis }) => {
    const Icon = stepIcons[analysis.stepName] || SparklesIcon;

    return (
        <Card className="p-4">
            <div className="flex flex-col md:flex-row md:items-start gap-4">
                <div className="md:w-1/3">
                    <div className="flex items-center gap-3">
                        <div className="bg-gray-700 p-2 rounded-lg">
                            <Icon className="w-6 h-6 text-blue-300" />
                        </div>
                        <h3 className="text-lg font-bold text-gray-100">{analysis.stepName}</h3>
                    </div>
                    <div className="mt-3">
                        <ScoreIndicator score={analysis.score} />
                    </div>
                </div>
                <div className="md:w-2/3 md:pl-4 md:border-l border-gray-700 space-y-3">
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-green-400">
                            <ThumbsUpIcon className="w-4 h-4" />
                            What Went Well
                        </h4>
                        <p className="text-gray-300 text-sm">{analysis.positiveFeedback}</p>
                    </div>
                    <div>
                        <h4 className="flex items-center gap-2 text-sm font-semibold text-amber-400">
                            <AlertTriangleIcon className="w-4 h-4" />
                            Area for Improvement
                        </h4>
                        <p className="text-gray-300 text-sm">{analysis.areaForImprovement}</p>
                    </div>
                </div>
            </div>
        </Card>
    );
}


const PerformanceReportView: React.FC<PerformanceReportViewProps> = ({ report }) => {
  return (
    <div className="p-4 md:p-6 space-y-6">
        <Card className="p-6">
            <h3 className="text-xl font-bold text-blue-300 mb-4 flex items-center gap-2"><SparklesIcon className="w-5 h-5"/>Overall Coaching Summary</h3>
            <div className="prose prose-invert max-w-none" dangerouslySetInnerHTML={{ __html: markdownToHtml(report.overallCoachingSummary) }} />
        </Card>

        <div>
            <h2 className="text-2xl font-bold text-gray-200 mb-4">Step-by-Step Analysis</h2>
            <div className="space-y-4">
                {report.stepByStepAnalysis.map((stepAnalysis) => (
                    <SalesStepCard key={stepAnalysis.stepName} analysis={stepAnalysis} />
                ))}
            </div>
        </div>
    </div>
  );
};

export default PerformanceReportView;