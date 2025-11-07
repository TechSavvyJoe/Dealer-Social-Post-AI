import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, Lightbulb, AlertTriangle, X } from 'lucide-react';
import { CoachingAlert as CoachingAlertType } from '../../types';
import { cn } from '../../lib/utils';
import { Card } from '../ui/card';

interface CoachingAlertProps {
  alert: CoachingAlertType;
  onDismiss?: (id: string) => void;
}

export function CoachingAlert({ alert, onDismiss }: CoachingAlertProps) {
  const icons = {
    critical: AlertCircle,
    opportunity: Lightbulb,
    suggestion: AlertTriangle,
  };

  const Icon = icons[alert.type];

  const colors = {
    critical: 'border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300',
    opportunity: 'border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-300',
    suggestion: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300',
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      layout
    >
      <Card className={cn('p-4 border-l-4', colors[alert.type])}>
        <div className="flex items-start gap-3">
          <Icon className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm mb-1">{alert.title}</h4>
            <p className="text-sm opacity-90">{alert.description}</p>
            <p className="text-xs opacity-70 mt-2">{alert.timestamp}</p>
          </div>
          {onDismiss && (
            <button
              onClick={() => onDismiss(alert.id)}
              className="hover:opacity-70 transition-opacity"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </Card>
    </motion.div>
  );
}

interface CoachingAlertsListProps {
  alerts: CoachingAlertType[];
  onDismiss?: (id: string) => void;
}

export function CoachingAlertsList({ alerts, onDismiss }: CoachingAlertsListProps) {
  if (alerts.length === 0) {
    return (
      <Card className="p-6 text-center">
        <Lightbulb className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">No coaching alerts yet</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <AnimatePresence mode="popLayout">
        {alerts.map((alert) => (
          <CoachingAlert key={alert.id} alert={alert} onDismiss={onDismiss} />
        ))}
      </AnimatePresence>
    </div>
  );
}
