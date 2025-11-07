import React, { useEffect, useState } from 'react';
import { UserRole, Salesperson, User } from '../types';
import { getSalespeople } from '../services/storageService';
import SalesmanIcon from './icons/SalesmanIcon';
import ManagerIcon from './icons/ManagerIcon';
import BriefcaseIcon from './icons/BriefcaseIcon';
import UsersIcon from './icons/UsersIcon';

interface LoginViewProps {
  onLogin: (user: User) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLogin }) => {
    const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
    
    useEffect(() => {
        setSalespeople(getSalespeople());
    }, []);

    const handleSelectSalesperson = (salesperson: Salesperson) => {
        onLogin({ ...salesperson, role: UserRole.SALESMAN });
    };

    const handleSelectManager = () => {
        onLogin({ id: 'manager_1', name: 'Manager', role: UserRole.MANAGER });
    };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-grid">
      <div className="text-center mb-12">
        <h1 className="text-5xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-indigo-500 mb-3">
          AI Sales Coach Suite
        </h1>
        <p className="text-lg text-gray-300">
          Please select your role to continue.
        </p>
      </div>
      
      <div className="w-full max-w-4xl p-8 bg-gray-800/30 border border-gray-700/50 rounded-2xl shadow-2xl backdrop-blur-lg">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Manager Login */}
            <div className="md:col-span-1 flex flex-col">
                <h2 className="text-2xl font-bold text-indigo-300 mb-4 flex items-center gap-3"><ManagerIcon className="w-6 h-6"/>Manager Login</h2>
                <div
                    onClick={handleSelectManager}
                    className="flex-grow flex flex-col items-center justify-center p-6 bg-gray-900/40 border border-gray-700 rounded-lg cursor-pointer transition-all hover:bg-indigo-600/20 hover:border-indigo-500"
                >
                    <ManagerIcon className="w-12 h-12 text-indigo-400 mb-3"/>
                    <span className="font-semibold text-white">Access Dashboard</span>
                </div>
            </div>

            {/* Salespeople Login */}
            <div className="md:col-span-2">
                <h2 className="text-2xl font-bold text-blue-300 mb-4 flex items-center gap-3"><UsersIcon className="w-6 h-6"/>Sales Team</h2>
                 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {salespeople.map(sp => (
                        <div
                            key={sp.id}
                            onClick={() => handleSelectSalesperson(sp)}
                            className="flex flex-col items-center p-4 bg-gray-900/40 border border-gray-700 rounded-lg cursor-pointer transition-all hover:bg-blue-600/20 hover:border-blue-500"
                        >
                            <SalesmanIcon className="w-10 h-10 text-blue-400 mb-2"/>
                            <span className="font-medium text-center">{sp.name}</span>
                        </div>
                    ))}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default LoginView;
