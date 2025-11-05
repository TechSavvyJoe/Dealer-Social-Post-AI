import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleOption, ToneOption } from '../types';
import { Icon } from './Icons';
import { triggerHapticFeedback } from '../utils/haptics';
import { Button } from './ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/Card';
import { Badge } from './ui/Badge';
import { Tooltip } from './ui/Tooltip';
import { POST_TEMPLATES } from './templates';

interface PostCustomizerProps {
  imageSrc: string;
  onGenerate: (style: StyleOption, tone: ToneOption, customerName: string, customText?: string) => void;
  onBack: () => void;
  dealershipName: string;
  defaultStyle: StyleOption;
  defaultTone: ToneOption;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  isApiKeyConfigured: boolean;
  onOpenSettings: () => void;
}

interface StylePreviewMeta {
  subtitle: string;
  gradient: string;
  tip: string;
}

const STYLE_PREVIEWS: Record<StyleOption, StylePreviewMeta> = {
  [StyleOption.Luxury]: {
    subtitle: 'Polished metallic typography with rich gold highlights.',
    gradient: 'from-yellow-500/80 via-amber-400/70 to-yellow-300/80',
    tip: 'Perfect for premium deliveries and luxury vehicles.',
  },
  [StyleOption.Modern]: {
    subtitle: 'Bold geometrics with crisp lighting and high contrast.',
    gradient: 'from-indigo-500/60 via-purple-500/60 to-pink-500/60',
    tip: 'Works well for electric vehicles or tech-forward messaging.',
  },
  [StyleOption.Friendly]: {
    subtitle: 'Rounded lettering, warm tones, and playful stickers.',
    gradient: 'from-rose-400/60 via-orange-400/60 to-amber-400/60',
    tip: 'Ideal for family-focused stories and first-car celebrations.',
  },
  [StyleOption.Sporty]: {
    subtitle: 'Dynamic angles with motion streaks and neon highlights.',
    gradient: 'from-sky-500/60 via-blue-500/60 to-violet-500/60',
    tip: 'Use to spotlight performance trims or racing-inspired features.',
  },
};

const TONE_DESCRIPTIONS: Record<ToneOption, string> = {
  [ToneOption.Excited]: 'Amp up the energy with hype-driven copy and exclamation points.',
  [ToneOption.Professional]: 'Confident, refined language perfect for luxury or fleet messaging.',
  [ToneOption.Family]: 'Warm, welcoming storytelling that highlights togetherness.',
  [ToneOption.Humorous]: 'Clever, fun copy with lighthearted wordplay.',
  [ToneOption.Inspirational]: 'Forward-looking language that celebrates big milestones.',
  [ToneOption.Promotional]: 'CTA-focused copy that teases offers without specifying pricing.',
};

interface StyleCardProps {
  option: StyleOption;
  current: StyleOption;
  onSelect: (option: StyleOption) => void;
}

const StyleCard: React.FC<StyleCardProps> = ({ option, current, onSelect }) => {
  const meta = STYLE_PREVIEWS[option];
  const isActive = option === current;

  return (
    <button
      onClick={() => {
        triggerHapticFeedback();
        onSelect(option);
      }}
      className={`group flex flex-col gap-3 rounded-2xl border px-4 py-5 text-left transition-all duration-200 ${
        isActive ? 'border-indigo-400 bg-indigo-500/20 shadow-lg shadow-indigo-500/30' : 'border-white/10 bg-white/5 hover:border-indigo-400/70 hover:bg-white/10'
      }`}
    >
      <div className={`h-24 w-full rounded-xl bg-gradient-to-r ${meta.gradient} opacity-80 group-hover:opacity-100 transition-opacity`} />
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{option}</span>
          {isActive && <Badge variant="success">Selected</Badge>}
        </div>
        <p className="text-xs text-indigo-100/80 leading-relaxed">{meta.subtitle}</p>
      </div>
    </button>
  );
};

interface ToneTileProps {
  tone: ToneOption;
  current: ToneOption;
  onSelect: (tone: ToneOption) => void;
}

const ToneTile: React.FC<ToneTileProps> = ({ tone, current, onSelect }) => {
  const isActive = tone === current;
  return (
    <button
      onClick={() => {
        triggerHapticFeedback();
        onSelect(tone);
      }}
      className={`rounded-xl border px-3 py-3 text-left transition-all duration-200 ${
        isActive ? 'border-emerald-400/70 bg-emerald-500/20 shadow-lg shadow-emerald-500/20' : 'border-white/10 bg-white/5 hover:border-emerald-400/50 hover:bg-white/10'
      }`}
    >
      <div className="flex items-center gap-2 text-sm font-semibold text-white">
        <Icon type={isActive ? 'check' : 'sparkles'} className="h-4 w-4" />
        {tone}
      </div>
      <p className="mt-2 text-xs text-indigo-100/80 leading-relaxed">{TONE_DESCRIPTIONS[tone]}</p>
    </button>
  );
};

export const PostCustomizer: React.FC<PostCustomizerProps> = ({
  imageSrc,
  onGenerate,
  onBack,
  dealershipName,
  defaultStyle,
  defaultTone,
  onStyleToneChange,
  isApiKeyConfigured,
  onOpenSettings,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [style, setStyle] = useState<StyleOption>(defaultStyle);
  const [tone, setTone] = useState<ToneOption>(defaultTone);
  const [customMessage, setCustomMessage] = useState('');
  const [captionSource, setCaptionSource] = useState<'ai' | 'template' | 'custom'>('ai');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');

  useEffect(() => {
    setStyle(defaultStyle);
  }, [defaultStyle]);

  useEffect(() => {
    setTone(defaultTone);
  }, [defaultTone]);

  useEffect(() => {
    onStyleToneChange(style, tone);
  }, [style, tone, onStyleToneChange]);

  const templateOptions = useMemo(() => POST_TEMPLATES, []);

  useEffect(() => {
    if (templateOptions.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templateOptions[0].id);
    }
  }, [templateOptions, selectedTemplateId]);

  const handleGenerate = useCallback(() => {
    triggerHapticFeedback();
    let preparedText: string | undefined;
    if (captionSource === 'template') {
      const template = templateOptions.find((tpl) => tpl.id === selectedTemplateId);
      if (template) {
        preparedText = template.content
          .replace(/\[Customer Name\]/g, customerName.trim() || 'our amazing customer')
          .replace(/\[Dealership Name\]/g, dealershipName);
      }
    } else if (captionSource === 'custom') {
      preparedText = customMessage.trim() || undefined;
    }
    onGenerate(style, tone, customerName, preparedText);
  }, [captionSource, tone, style, customerName, customMessage, dealershipName, onGenerate, selectedTemplateId, templateOptions]);

  return (
    <div className="grid w-full max-w-screen-2xl mx-auto grid-cols-1 gap-6 px-1 sm:px-0 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Card className="order-2 lg:order-1 h-full">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>Customize the Experience</CardTitle>
            <CardDescription>
              Dial in the visuals and tone; we&apos;ll instantly remember your choices for the next post.
            </CardDescription>
          </div>
          <Tooltip label="Back to photo">
            <Button variant="ghost" size="sm" onClick={() => { triggerHapticFeedback(); onBack(); }}>
              <Icon type="retake" className="h-4 w-4" />
            </Button>
          </Tooltip>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-indigo-100">Customer&apos;s first name</span>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                placeholder="Optional"
                className="rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
              />
            </label>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Visual direction</h4>
              <Badge variant="info">Live preview</Badge>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {Object.values(StyleOption).map((option) => (
                <StyleCard key={option} option={option} current={style} onSelect={setStyle} />
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Caption strategy</h4>
            <div className="grid gap-3 sm:grid-cols-3">
              <Button
                variant={captionSource === 'ai' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { triggerHapticFeedback(); setCaptionSource('ai'); }}
              >
                <Icon type="sparkles" className="h-4 w-4" />
                <span>AI Generated</span>
              </Button>
              <Button
                variant={captionSource === 'template' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { triggerHapticFeedback(); setCaptionSource('template'); }}
              >
                <Icon type="settings" className="h-4 w-4" />
                <span>Template</span>
              </Button>
              <Button
                variant={captionSource === 'custom' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => { triggerHapticFeedback(); setCaptionSource('custom'); }}
              >
                <Icon type="edit" className="h-4 w-4" />
                <span>Write my own</span>
              </Button>
            </div>

            {captionSource === 'ai' && (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.values(ToneOption).map((option) => (
                  <ToneTile key={option} tone={option} current={tone} onSelect={setTone} />
                ))}
              </div>
            )}

            {captionSource === 'template' && (
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Template</span>
                <select
                  className="rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                  value={selectedTemplateId}
                  onChange={(event) => setSelectedTemplateId(event.target.value)}
                >
                  {templateOptions.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {captionSource === 'custom' && (
              <label className="flex flex-col gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Your message</span>
                <textarea
                  value={customMessage}
                  onChange={(event) => setCustomMessage(event.target.value)}
                  rows={4}
                  className="min-h-[120px] rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                  placeholder="We&apos;ll inject this copy straight into the design."
                />
              </label>
            )}
          </div>

          {!isApiKeyConfigured && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="flex items-center gap-2 font-semibold">
                <Icon type="settings" className="h-4 w-4" />
                Add your Gemini API key to turn on generation.
              </span>
              <Button variant="outline" size="sm" onClick={() => { triggerHapticFeedback(); onOpenSettings(); }}>
                Open Settings
              </Button>
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Button variant="secondary" size="md" onClick={() => { triggerHapticFeedback(); onBack(); }}>
              <Icon type="retake" className="h-4 w-4" />
              Change photo
            </Button>
            <Button size="lg" onClick={handleGenerate} disabled={!isApiKeyConfigured}>
              <Icon type="check" className="h-5 w-5" />
              {isApiKeyConfigured ? 'Generate hero image & caption' : 'Add API key to generate'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="order-1 overflow-hidden lg:order-2 h-full">
        <CardHeader className="flex items-center justify-between">
          <div>
            <CardTitle>Live preview</CardTitle>
            <CardDescription>
              The final render will respect safe zones, dealership branding, and your selections above.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="relative overflow-hidden rounded-2xl border border-white/10">
            <img src={imageSrc} alt="Selected" className="h-full w-full object-cover" />
            <div className="absolute left-4 top-4 flex flex-col gap-2">
              <Badge variant="info">Style: {style}</Badge>
              <Badge variant="success">Tone: {tone}</Badge>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
