import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import {
  Sparkles, User, Car, DollarSign, Clock, Target,
  Lightbulb, AlertCircle, CheckCircle2, Loader2, Copy
} from 'lucide-react';
import { getPrecallBriefing } from '../../services/geminiService';
import { useUIStore } from '../../stores/uiStore';
import type { PrecallBriefingInput } from '../../types';

export function PrecallBriefing() {
  const [formData, setFormData] = useState<PrecallBriefingInput>({
    customerName: '',
    vehicleInterest: '',
    budget: '',
    previousInteractions: '',
    appointmentTime: '',
    specialNotes: '',
  });
  const [briefing, setBriefing] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const { addToast } = useUIStore();

  const handleInputChange = (field: keyof PrecallBriefingInput, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleGenerate = async () => {
    // Validation
    if (!formData.customerName.trim()) {
      addToast({
        title: 'Customer name required',
        description: 'Please enter the customer name',
        type: 'error',
      });
      return;
    }

    setIsGenerating(true);
    setBriefing('');

    try {
      const result = await getPrecallBriefing(formData);
      setBriefing(result);
      addToast({
        title: 'Briefing generated',
        description: 'Your pre-call briefing is ready',
        type: 'success',
      });
    } catch (error) {
      console.error('Error generating briefing:', error);
      addToast({
        title: 'Generation failed',
        description: 'Could not generate briefing. Please try again.',
        type: 'error',
      });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(briefing);
    addToast({
      title: 'Copied',
      description: 'Briefing copied to clipboard',
      type: 'success',
    });
  };

  const handleClear = () => {
    setFormData({
      customerName: '',
      vehicleInterest: '',
      budget: '',
      previousInteractions: '',
      appointmentTime: '',
      specialNotes: '',
    });
    setBriefing('');
  };

  const isFormValid = formData.customerName.trim().length > 0;

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Input Form */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="h-full">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="w-5 h-5" />
              Customer Information
            </CardTitle>
            <CardDescription>
              Enter details about the customer and upcoming meeting
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Customer Name */}
            <div className="space-y-2">
              <Label htmlFor="customerName" required>
                Customer Name
              </Label>
              <Input
                id="customerName"
                placeholder="John Smith"
                value={formData.customerName}
                onChange={(e) => handleInputChange('customerName', e.target.value)}
              />
            </div>

            {/* Vehicle Interest */}
            <div className="space-y-2">
              <Label htmlFor="vehicleInterest">
                <Car className="w-4 h-4 inline mr-1" />
                Vehicle Interest
              </Label>
              <Input
                id="vehicleInterest"
                placeholder="2024 Toyota Camry, SUV, Hybrid"
                value={formData.vehicleInterest}
                onChange={(e) => handleInputChange('vehicleInterest', e.target.value)}
              />
            </div>

            {/* Budget */}
            <div className="space-y-2">
              <Label htmlFor="budget">
                <DollarSign className="w-4 h-4 inline mr-1" />
                Budget Range
              </Label>
              <Input
                id="budget"
                placeholder="$25,000 - $35,000"
                value={formData.budget}
                onChange={(e) => handleInputChange('budget', e.target.value)}
              />
            </div>

            {/* Appointment Time */}
            <div className="space-y-2">
              <Label htmlFor="appointmentTime">
                <Clock className="w-4 h-4 inline mr-1" />
                Appointment Time
              </Label>
              <Input
                id="appointmentTime"
                type="datetime-local"
                value={formData.appointmentTime}
                onChange={(e) => handleInputChange('appointmentTime', e.target.value)}
              />
            </div>

            {/* Previous Interactions */}
            <div className="space-y-2">
              <Label htmlFor="previousInteractions">Previous Interactions</Label>
              <Textarea
                id="previousInteractions"
                placeholder="Customer visited showroom last week, test drove a sedan, mentioned need for family vehicle..."
                rows={3}
                value={formData.previousInteractions}
                onChange={(e) => handleInputChange('previousInteractions', e.target.value)}
              />
            </div>

            {/* Special Notes */}
            <div className="space-y-2">
              <Label htmlFor="specialNotes">Special Notes</Label>
              <Textarea
                id="specialNotes"
                placeholder="First-time buyer, prefers fuel efficiency, trade-in available..."
                rows={3}
                value={formData.specialNotes}
                onChange={(e) => handleInputChange('specialNotes', e.target.value)}
              />
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-2">
              <Button
                onClick={handleGenerate}
                disabled={!isFormValid || isGenerating}
                className="flex-1"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    Generate Briefing
                  </>
                )}
              </Button>
              <Button
                onClick={handleClear}
                variant="outline"
                disabled={isGenerating}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>

      {/* Briefing Output */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.5, delay: 0.1 }}
      >
        <Card className="h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  AI-Generated Briefing
                </CardTitle>
                <CardDescription>Strategic insights for your upcoming call</CardDescription>
              </div>
              {briefing && (
                <Button size="sm" variant="outline" onClick={handleCopy}>
                  <Copy className="w-4 h-4 mr-2" />
                  Copy
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <AnimatePresence mode="wait">
              {isGenerating ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-12 space-y-4"
                >
                  <Loader2 className="w-12 h-12 text-primary animate-spin" />
                  <p className="text-sm text-muted-foreground">
                    Analyzing customer information...
                  </p>
                </motion.div>
              ) : briefing ? (
                <motion.div
                  key="briefing"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20 }}
                  className="space-y-4"
                >
                  <BriefingContent content={briefing} />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-center py-12 space-y-4"
                >
                  <Target className="w-12 h-12 text-muted-foreground mx-auto opacity-50" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">No briefing generated yet</p>
                    <p className="text-xs text-muted-foreground">
                      Fill in the customer information and click "Generate Briefing"
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// Briefing Content Parser and Display
function BriefingContent({ content }: { content: string }) {
  // Parse the briefing into sections
  const sections = content.split('\n\n').filter(s => s.trim());

  const getSectionIcon = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('key point') || lower.includes('summary')) return Lightbulb;
    if (lower.includes('strategy') || lower.includes('approach')) return Target;
    if (lower.includes('risk') || lower.includes('concern')) return AlertCircle;
    if (lower.includes('opportunity') || lower.includes('strength')) return CheckCircle2;
    return Sparkles;
  };

  const getSectionColor = (text: string) => {
    const lower = text.toLowerCase();
    if (lower.includes('risk') || lower.includes('concern')) return 'text-amber-600 dark:text-amber-500';
    if (lower.includes('opportunity') || lower.includes('strength')) return 'text-green-600 dark:text-green-500';
    if (lower.includes('strategy') || lower.includes('approach')) return 'text-blue-600 dark:text-blue-500';
    return 'text-primary';
  };

  return (
    <div className="space-y-4">
      {sections.map((section, index) => {
        const lines = section.split('\n');
        const isHeading = lines[0].endsWith(':') || lines[0].startsWith('#');
        const Icon = getSectionIcon(section);
        const color = getSectionColor(section);

        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.1 }}
            className="space-y-2"
          >
            {isHeading ? (
              <div className="space-y-2">
                <div className={`flex items-center gap-2 font-semibold ${color}`}>
                  <Icon className="w-4 h-4" />
                  <span>{lines[0].replace(/^#+\s*/, '').replace(/:$/, '')}</span>
                </div>
                {lines.slice(1).map((line, i) => (
                  <p key={i} className="text-sm text-foreground ml-6">
                    {line.replace(/^-\s*/, '• ')}
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-foreground">{section}</p>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}

// Compact briefing card for dashboard
export function PrecallBriefingCard() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-5 h-5" />
          Pre-Call Briefing
        </CardTitle>
        <CardDescription>Get AI-powered insights before customer calls</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-sm">
            <Target className="w-8 h-8 text-primary opacity-50" />
            <p className="text-muted-foreground">
              Enter customer details to receive strategic recommendations and talking points
            </p>
          </div>
          <Button className="w-full" size="sm">
            <Sparkles className="w-4 h-4 mr-2" />
            Create New Briefing
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
