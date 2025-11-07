import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { StepAnalysisChart } from './AnalyticsCharts';
import {
  TrendingUp, TrendingDown, CheckCircle2, AlertCircle,
  Target, Lightbulb, Award, MessageSquare, Clock, BarChart3
} from 'lucide-react';
import type { PerformanceReport, SalesStepAnalysis } from '../../types';

interface PerformanceReportViewerProps {
  report: PerformanceReport;
  className?: string;
}

export function PerformanceReportViewer({ report, className = '' }: PerformanceReportViewerProps) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-blue-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getScoreGradient = (score: number) => {
    if (score >= 80) return 'from-green-500/20 to-emerald-500/20';
    if (score >= 60) return 'from-blue-500/20 to-cyan-500/20';
    if (score >= 40) return 'from-yellow-500/20 to-orange-500/20';
    return 'from-red-500/20 to-pink-500/20';
  };

  const getPerformanceBadge = (performance: string) => {
    const variants = {
      excellent: { variant: 'default' as const, color: 'bg-green-500' },
      good: { variant: 'default' as const, color: 'bg-blue-500' },
      needs_improvement: { variant: 'secondary' as const, color: 'bg-yellow-500' },
      poor: { variant: 'destructive' as const, color: 'bg-red-500' },
    };
    return variants[performance as keyof typeof variants] || variants.good;
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header Card - Overall Score */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className={`border-2 bg-gradient-to-br ${getScoreGradient(report.overallScore)}`}>
          <CardHeader className="text-center pb-4">
            <div className="flex items-center justify-center mb-2">
              <Award className="w-8 h-8 text-primary" />
            </div>
            <CardTitle className="text-2xl">Performance Report</CardTitle>
            <CardDescription>
              Call analysis based on {report.steps.length} sales steps
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <div className={`text-6xl font-bold mb-2 ${getScoreColor(report.overallScore)}`}>
              {report.overallScore}
              <span className="text-2xl">/100</span>
            </div>
            <p className="text-sm text-muted-foreground mb-4">Overall Performance Score</p>
            <Progress value={report.overallScore} className="h-3 mb-4" />
            <div className="flex items-center justify-center gap-4 text-sm">
              <div className="flex items-center gap-1">
                <Clock className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">
                  {Math.round(report.steps.reduce((sum, s) => sum + s.duration, 0) / 60)} min total
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Target className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">{report.steps.length} steps</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Strengths and Improvements Grid */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Strengths */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="border-green-500/30 h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-green-600 dark:text-green-500">
                <CheckCircle2 className="w-5 h-5" />
                Key Strengths
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.strengths.length > 0 ? (
                <ul className="space-y-3">
                  {report.strengths.map((strength, index) => (
                    <motion.li
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + index * 0.1 }}
                      className="flex items-start gap-2"
                    >
                      <TrendingUp className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                      <span className="text-sm">{strength}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No specific strengths identified.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Areas for Improvement */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <Card className="border-amber-500/30 h-full">
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2 text-amber-600 dark:text-amber-500">
                <AlertCircle className="w-5 h-5" />
                Areas for Improvement
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.areasForImprovement.length > 0 ? (
                <ul className="space-y-3">
                  {report.areasForImprovement.map((area, index) => (
                    <motion.li
                      key={index}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.2 + index * 0.1 }}
                      className="flex items-start gap-2"
                    >
                      <TrendingDown className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                      <span className="text-sm">{area}</span>
                    </motion.li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No areas for improvement identified.</p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* Recommendations */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <Card className="border-blue-500/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2 text-blue-600 dark:text-blue-500">
              <Lightbulb className="w-5 h-5" />
              Recommendations
            </CardTitle>
            <CardDescription>Actionable steps to improve performance</CardDescription>
          </CardHeader>
          <CardContent>
            {report.recommendations.length > 0 ? (
              <div className="space-y-3">
                {report.recommendations.map((recommendation, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className="flex items-start gap-3 p-3 rounded-lg bg-blue-500/5 border border-blue-500/20"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500 text-white text-xs font-bold shrink-0">
                      {index + 1}
                    </div>
                    <p className="text-sm flex-1">{recommendation}</p>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No specific recommendations at this time.</p>
            )}
          </CardContent>
        </Card>
      </motion.div>

      {/* Step-by-Step Analysis */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.3 }}
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Step-by-Step Analysis
            </CardTitle>
            <CardDescription>Detailed breakdown of each sales step</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.steps.map((step, index) => {
              const badgeConfig = getPerformanceBadge(step.performance);
              return (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.4 + index * 0.1 }}
                  className="border rounded-lg p-4 space-y-3 hover:border-primary/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="font-semibold">{step.stepName}</h4>
                        <Badge variant={badgeConfig.variant} className="capitalize">
                          {step.performance.replace('_', ' ')}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {Math.round(step.duration / 60)} minutes
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Feedback */}
                  <div className="bg-muted/50 rounded-md p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground">Feedback</span>
                    </div>
                    <p className="text-sm">{step.feedback}</p>
                  </div>

                  {/* Recommendations */}
                  {step.recommendations.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="w-4 h-4 text-blue-500" />
                        <span className="text-xs font-medium text-muted-foreground">
                          Step Recommendations
                        </span>
                      </div>
                      <ul className="space-y-1.5 ml-6">
                        {step.recommendations.map((rec, recIndex) => (
                          <li
                            key={recIndex}
                            className="text-sm text-muted-foreground list-disc"
                          >
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </CardContent>
        </Card>
      </motion.div>

      {/* Visual Chart */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, delay: 0.4 }}
      >
        <StepAnalysisChart steps={report.steps} />
      </motion.div>
    </div>
  );
}

// Compact version for dashboard overview
export function PerformanceReportSummary({ report }: { report: PerformanceReport }) {
  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-blue-500';
    if (score >= 40) return 'text-yellow-500';
    return 'text-red-500';
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Award className="w-5 h-5" />
          Performance Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-center">
          <div className={`text-4xl font-bold ${getScoreColor(report.overallScore)}`}>
            {report.overallScore}/100
          </div>
          <Progress value={report.overallScore} className="h-2 mt-2" />
        </div>

        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <div className="text-2xl font-bold text-green-500">{report.strengths.length}</div>
            <div className="text-xs text-muted-foreground">Strengths</div>
          </div>
          <div>
            <div className="text-2xl font-bold text-amber-500">
              {report.areasForImprovement.length}
            </div>
            <div className="text-xs text-muted-foreground">Improvements</div>
          </div>
        </div>

        {report.recommendations.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Top Recommendation</div>
            <p className="text-sm p-2 rounded-md bg-blue-500/10 border border-blue-500/20">
              {report.recommendations[0]}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
