import React from 'react';

interface BarChartProps {
  data: { label: string; value: number }[];
  maxValue: number;
}

const BarChart: React.FC<BarChartProps> = ({ data, maxValue }) => {
  const getColor = (value: number) => {
    const percentage = (value / maxValue) * 100;
    if (percentage >= 80) return 'fill-green-500';
    if (percentage >= 50) return 'fill-yellow-500';
    return 'fill-red-500';
  };

  return (
    <div className="w-full bg-gray-900/30 p-4 rounded-lg">
      <div className="flex justify-between items-end h-64 space-x-2">
        {data.map((item, index) => (
          <div key={index} className="flex-1 flex flex-col items-center justify-end h-full group">
            <div
              className={`w-full rounded-t-md transition-all duration-300 ease-in-out ${getColor(item.value)} hover:opacity-80`}
              style={{ height: `${(item.value / maxValue) * 100}%` }}
              title={`${item.label}: ${item.value.toFixed(1)} / ${maxValue}`}
            >
             <div className="text-center font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity">
                {item.value.toFixed(1)}
             </div>
            </div>
          </div>
        ))}
      </div>
       <div className="flex justify-between items-start mt-2 border-t border-gray-700 pt-2">
        {data.map((item, index) => (
            <div key={index} className="flex-1 text-center">
                 <p className="text-xs text-gray-400 transform -rotate-45 whitespace-nowrap origin-top-left">{item.label}</p>
            </div>
        ))}
      </div>
    </div>
  );
};

export default BarChart;
