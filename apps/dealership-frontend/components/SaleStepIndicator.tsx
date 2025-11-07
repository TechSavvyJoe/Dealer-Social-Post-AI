import React from 'react';
import GreetingIcon from './icons/GreetingIcon';
import ProfileIcon from './icons/ProfileIcon';
import AppraisalIcon from './icons/AppraisalIcon';
import DemonstrationIcon from './icons/DemonstrationIcon';
import PresentationIcon from './icons/PresentationIcon';
import DeliveryIcon from './icons/DeliveryIcon';

type StepName = 'Greeting' | 'Building a Profile' | 'Appraisal' | 'Selection & Demonstration' | 'Write Up & Presentation' | 'Delivery & Follow Up' | 'Unknown';

interface SaleStepIndicatorProps {
  currentStep: StepName;
}

const steps: { name: StepName, Icon: React.FC<React.SVGProps<SVGSVGElement>> }[] = [
  { name: 'Greeting', Icon: GreetingIcon },
  { name: 'Building a Profile', Icon: ProfileIcon },
  { name: 'Appraisal', Icon: AppraisalIcon },
  { name: 'Selection & Demonstration', Icon: DemonstrationIcon },
  { name: 'Write Up & Presentation', Icon: PresentationIcon },
  { name: 'Delivery & Follow Up', Icon: DeliveryIcon },
];

const SaleStepIndicator: React.FC<SaleStepIndicatorProps> = ({ currentStep }) => {
  const currentStepIndex = steps.findIndex(step => step.name === currentStep);

  return (
    <div className="bg-gray-800/50 border border-gray-700/50 p-3 rounded-xl shadow-lg">
      <div className="flex items-center justify-between">
        {steps.map((step, index) => {
          const isActive = index === currentStepIndex;
          const isCompleted = index < currentStepIndex;

          return (
            <React.Fragment key={step.name}>
              <div className="flex flex-col items-center text-center">
                <div
                  className={`
                    w-12 h-12 rounded-full flex items-center justify-center border-2 transition-all duration-300
                    ${isActive ? 'bg-blue-600 border-blue-400 shadow-md scale-110' : isCompleted ? 'bg-green-600 border-green-500' : 'bg-gray-700 border-gray-600'}
                  `}
                >
                  <step.Icon className={`w-6 h-6 ${isActive || isCompleted ? 'text-white' : 'text-gray-400'}`} />
                </div>
                <p className={`mt-2 text-xs font-semibold transition-colors ${isActive ? 'text-blue-300' : isCompleted ? 'text-gray-300' : 'text-gray-500'}`}>
                  {step.name}
                </p>
              </div>
              {index < steps.length - 1 && (
                <div className={`flex-1 h-1 mx-2 rounded-full transition-colors duration-500 ${isCompleted ? 'bg-green-500' : 'bg-gray-700'}`}></div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};

export default SaleStepIndicator;
