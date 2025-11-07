import React from 'react';
import { UserRole } from '../types';
import SalesmanIcon from './icons/SalesmanIcon';
import ManagerIcon from './icons/ManagerIcon';

interface RoleSelectorProps {
  onSelectRole: (role: UserRole) => void;
}

const RoleCard: React.FC<{
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
  colorClass: string;
}> = ({ icon, title, description, onClick, colorClass }) => (
  <div
    onClick={onClick}
    className={`
      bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl 
      p-8 w-full max-w-sm cursor-pointer
      flex flex-col items-center text-center
      transition-all duration-300 ease-in-out
      hover:bg-gray-700/70 hover:border-gray-500 hover:-translate-y-2
    `}
  >
    <div className={`p-4 rounded-full mb-6 ${colorClass}`}>
      {icon}
    </div>
    <h2 className="text-3xl font-bold text-white mb-2">{title}</h2>
    <p className="text-gray-400">{description}</p>
  </div>
);

const RoleSelector: React.FC<RoleSelectorProps> = ({ onSelectRole }) => {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-grid">
      <div className="text-center mb-12">
        <h1 className="text-5xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 mb-3">
          AI Sales Coach
        </h1>
        <p className="text-lg text-gray-300">
          Empowering your dealership with real-time insights.
        </p>
      </div>
      <div className="flex flex-col md:flex-row gap-8">
        <RoleCard
          onClick={() => onSelectRole(UserRole.SALESMAN)}
          icon={<SalesmanIcon className="w-12 h-12 text-white" />}
          title="Salesman"
          description="Record your sales conversations for live transcription and post-sale analysis."
          colorClass="bg-blue-600/50"
        />
        <RoleCard
          onClick={() => onSelectRole(UserRole.MANAGER)}
          icon={<ManagerIcon className="w-12 h-12 text-white" />}
          title="Manager"
          description="Monitor live sales, get AI-powered coaching tips, and track performance."
          colorClass="bg-indigo-600/50"
        />
      </div>
    </div>
  );
};

export default RoleSelector;