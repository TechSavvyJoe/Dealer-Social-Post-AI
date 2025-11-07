import React, { useState, useEffect } from 'react';
import { CoachingAlertItem } from '../services/geminiService';
import AlertTriangleIcon from './icons/AlertTriangleIcon';
import LightbulbIcon from './icons/LightbulbIcon';
import InfoIcon from './icons/InfoIcon';

interface CoachingAlertProps {
  alert: CoachingAlertItem;
  onDismiss: () => void;
}

const alertConfig = {
    Critical: {
        Icon: AlertTriangleIcon,
        style: 'bg-amber-500/10 border-amber-400',
        iconColor: 'text-amber-400',
        title: 'Critical Alert',
        titleColor: 'text-amber-300',
    },
    Opportunity: {
        Icon: LightbulbIcon,
        style: 'bg-cyan-500/10 border-cyan-400',
        iconColor: 'text-cyan-400',
        title: 'Opportunity Detected',
        titleColor: 'text-cyan-300',
    },
    Suggestion: {
        Icon: InfoIcon,
        style: 'bg-blue-500/10 border-blue-400',
        iconColor: 'text-blue-400',
        title: 'Coaching Suggestion',
        titleColor: 'text-blue-300',
    }
}

const CoachingAlert: React.FC<CoachingAlertProps> = ({ alert, onDismiss }) => {
  const [isVisible, setIsVisible] = useState(false);
  const config = alertConfig[alert.severity] || alertConfig.Suggestion;

  useEffect(() => {
    setIsVisible(true);
    const timer = setTimeout(() => {
      handleClose();
    }, 12000); // 12 seconds
    return () => clearTimeout(timer);
  }, []);
  
  const handleClose = () => {
      setIsVisible(false);
      setTimeout(onDismiss, 300);
  }

  return (
    <div
      className={`
        border-l-4 p-4 rounded-lg shadow-lg
        flex items-start space-x-4
        transition-all duration-300 ease-in-out backdrop-blur-md
        ${config.style}
        ${isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
      role="alert"
    >
      <div className={`flex-shrink-0 ${config.iconColor}`}>
        <config.Icon className="w-6 h-6" />
      </div>
      <div className="flex-grow">
        <h4 className={`font-bold ${config.titleColor}`}>{config.title}</h4>
        <div className="text-sm text-gray-200 mt-2">
            <p className="font-semibold text-gray-400">Issue:</p>
            <p className="mb-2">{alert.issue}</p>
            <p className="font-semibold text-gray-400">Suggested Action:</p>
            <p>{alert.suggestion}</p>
        </div>
      </div>
      <div className="flex-shrink-0">
        <button
          onClick={handleClose}
          className="text-gray-400 hover:text-white transition-colors"
          aria-label="Dismiss"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            ></path>
          </svg>
        </button>
      </div>
    </div>
  );
};

export default CoachingAlert;