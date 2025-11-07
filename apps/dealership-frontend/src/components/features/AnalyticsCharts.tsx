import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  PieChart, Pie, Cell, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts';
import type { SalesStepAnalysis } from '../../types';

// Custom Tooltip Component
interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
  if (active && payload && payload.length) {
    return (
      <div className="glass rounded-lg border border-border p-3 shadow-lg">
        <p className="text-sm font-medium mb-2">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} className="text-xs" style={{ color: entry.color }}>
            {entry.name}: {typeof entry.value === 'number' ? entry.value.toFixed(1) : entry.value}
            {entry.dataKey.includes('Rate') || entry.dataKey.includes('Probability') ? '%' : ''}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Colors
const CHART_COLORS = {
  primary: 'hsl(221, 83%, 53%)',
  success: 'hsl(142, 71%, 45%)',
  warning: 'hsl(38, 92%, 50%)',
  danger: 'hsl(0, 84%, 60%)',
  info: 'hsl(199, 89%, 48%)',
  purple: 'hsl(271, 91%, 65%)',
  gradient: ['hsl(221, 83%, 53%)', 'hsl(271, 91%, 65%)', 'hsl(142, 71%, 45%)'],
};

// Performance Over Time Chart
interface PerformanceData {
  date: string;
  successRate: number;
  avgDuration: number;
  callCount: number;
}

export function PerformanceOverTimeChart({ data }: { data: PerformanceData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Performance Trends</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="successGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.3} />
                <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="date"
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <YAxis
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Area
              type="monotone"
              dataKey="successRate"
              stroke={CHART_COLORS.success}
              fill="url(#successGradient)"
              strokeWidth={2}
              name="Success Rate (%)"
            />
            <Line
              type="monotone"
              dataKey="callCount"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              dot={{ r: 4 }}
              name="Calls"
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Sales Step Performance Chart
interface StepPerformanceData {
  step: string;
  successRate: number;
  avgDuration: number;
  count: number;
}

export function SalesStepChart({ data }: { data: StepPerformanceData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Sales Step Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis type="number" className="text-xs" tick={{ fill: 'currentColor' }} />
            <YAxis
              type="category"
              dataKey="step"
              width={120}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar
              dataKey="successRate"
              fill={CHART_COLORS.primary}
              radius={[0, 4, 4, 0]}
              name="Success Rate (%)"
            />
            <Bar
              dataKey="avgDuration"
              fill={CHART_COLORS.info}
              radius={[0, 4, 4, 0]}
              name="Avg Duration (min)"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Team Performance Comparison
interface TeamMemberData {
  name: string;
  successRate: number;
  totalCalls: number;
  avgDuration: number;
}

export function TeamComparisonChart({ data }: { data: TeamMemberData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Team Performance</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="name"
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <YAxis className="text-xs" tick={{ fill: 'currentColor' }} />
            <Tooltip content={<CustomTooltip />} />
            <Legend />
            <Bar
              dataKey="successRate"
              fill={CHART_COLORS.success}
              radius={[4, 4, 0, 0]}
              name="Success Rate (%)"
            />
            <Bar
              dataKey="totalCalls"
              fill={CHART_COLORS.primary}
              radius={[4, 4, 0, 0]}
              name="Total Calls"
            />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Success Distribution Pie Chart
interface SuccessDistribution {
  name: string;
  value: number;
}

export function SuccessDistributionChart({ data }: { data: SuccessDistribution[] }) {
  const COLORS = [
    CHART_COLORS.success,
    CHART_COLORS.warning,
    CHART_COLORS.danger,
    CHART_COLORS.info,
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Success Distribution</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              labelLine={false}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
              outerRadius={80}
              fill="#8884d8"
              dataKey="value"
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip content={<CustomTooltip />} />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Skills Radar Chart
interface SkillData {
  skill: string;
  score: number;
  fullMark: number;
}

export function SkillsRadarChart({ data }: { data: SkillData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Skills Analysis</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart data={data}>
            <PolarGrid className="stroke-muted" />
            <PolarAngleAxis
              dataKey="skill"
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <Radar
              name="Score"
              dataKey="score"
              stroke={CHART_COLORS.primary}
              fill={CHART_COLORS.primary}
              fillOpacity={0.3}
            />
            <Tooltip content={<CustomTooltip />} />
          </RadarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

// Step Analysis Breakdown
export function StepAnalysisChart({ steps }: { steps: SalesStepAnalysis[] }) {
  const data = steps.map(step => ({
    name: step.stepName,
    performance: step.performance,
    duration: Math.round(step.duration / 60), // Convert to minutes
  }));

  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case 'excellent': return CHART_COLORS.success;
      case 'good': return CHART_COLORS.info;
      case 'needs_improvement': return CHART_COLORS.warning;
      case 'poor': return CHART_COLORS.danger;
      default: return CHART_COLORS.primary;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Call Step Breakdown</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {steps.map((step, index) => (
          <div key={index} className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{step.stepName}</span>
              <div className="flex items-center gap-2">
                <span
                  className="capitalize text-xs px-2 py-1 rounded-md"
                  style={{
                    backgroundColor: `${getPerformanceColor(step.performance)}20`,
                    color: getPerformanceColor(step.performance),
                  }}
                >
                  {step.performance.replace('_', ' ')}
                </span>
                <span className="text-xs text-muted-foreground">
                  {Math.round(step.duration / 60)}min
                </span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">{step.feedback}</p>
            {step.recommendations.length > 0 && (
              <ul className="text-xs space-y-1 ml-4 list-disc text-muted-foreground">
                {step.recommendations.map((rec, i) => (
                  <li key={i}>{rec}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// Success Probability Gauge
export function SuccessProbabilityGauge({ probability }: { probability: number }) {
  const data = [
    { name: 'Success', value: probability },
    { name: 'Risk', value: 100 - probability },
  ];

  const getColor = (value: number) => {
    if (value >= 70) return CHART_COLORS.success;
    if (value >= 40) return CHART_COLORS.warning;
    return CHART_COLORS.danger;
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Success Probability</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center">
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                startAngle={180}
                endAngle={0}
                innerRadius={60}
                outerRadius={80}
                paddingAngle={0}
                dataKey="value"
              >
                <Cell fill={getColor(probability)} />
                <Cell fill="hsl(var(--muted))" />
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="text-center -mt-4">
            <div className="text-4xl font-bold" style={{ color: getColor(probability) }}>
              {probability}%
            </div>
            <p className="text-xs text-muted-foreground mt-1">Success Rate</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// Real-time Activity Feed Chart
interface ActivityData {
  time: string;
  sentiment: number;
  engagement: number;
}

export function ActivityFeedChart({ data }: { data: ActivityData[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Real-time Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis
              dataKey="time"
              className="text-xs"
              tick={{ fill: 'currentColor' }}
            />
            <YAxis className="text-xs" tick={{ fill: 'currentColor' }} domain={[0, 100]} />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="sentiment"
              stroke={CHART_COLORS.success}
              strokeWidth={2}
              dot={false}
              name="Sentiment"
            />
            <Line
              type="monotone"
              dataKey="engagement"
              stroke={CHART_COLORS.primary}
              strokeWidth={2}
              dot={false}
              name="Engagement"
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
