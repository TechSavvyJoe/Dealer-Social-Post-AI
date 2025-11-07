import React from 'react';

interface DonutChartProps {
  data: {
    name: string;
    value: number;
    color: string;
  }[];
  size?: number;
}

const DonutChart: React.FC<DonutChartProps> = ({ data, size = 120 }) => {
  const halfsize = size / 2;
  const radius = halfsize - 10;
  const circumference = 2 * Math.PI * radius;
  let total = data.reduce((acc, item) => acc + item.value, 0);
  if (total === 0) total = 1;

  let filled = 0;

  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <g transform={`translate(${halfsize},${halfsize}) rotate(-90)`}>
          {data.map((item, index) => {
            const dashoffset = circumference * (1 - (filled / total));
            const dasharray = `${(circumference * item.value) / total} ${circumference}`;
            filled += item.value;
            return (
              <circle
                key={index}
                r={radius}
                cx="0"
                cy="0"
                fill="transparent"
                stroke={item.color}
                strokeWidth="20"
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
                strokeLinecap="butt"
              />
            );
          })}
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {data.map((item, index) => (
          <div key={index} className="flex items-center text-xs">
            <span className="w-2 h-2 rounded-full mr-1.5" style={{ backgroundColor: item.color }}></span>
            <span className="font-semibold text-gray-300">{item.name}: {item.value}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default DonutChart;
