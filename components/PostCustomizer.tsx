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
  onGenerate: (style: StyleOption, tone: ToneOption, customerName: string, customText?: string, creativeBrief?: string) => void;
  onBack: () => void;
  dealershipName: string;
  defaultStyle: StyleOption;
  defaultTone: ToneOption;
  onStyleToneChange: (style: StyleOption, tone: ToneOption) => void;
  isApiKeyConfigured: boolean;
  onOpenSettings: () => void;
  isDesktopLayout: boolean;
}

interface StyleGuideMeta {
  subtitle: string;
  talkingPoints: string[];
  aiHint: string;
}

const STYLE_GUIDES: Record<StyleOption, StyleGuideMeta> = {
  [StyleOption.Luxury]: {
    subtitle: 'Polished metallic typography with rich gold highlights.',
    talkingPoints: [
      'Think upscale magazine spreads and premium concierge vibes.',
      'Use refined serif typography and generous negative space.',
      'Lean into champagne, onyx, and warm spotlight accents.',
    ],
    aiHint: 'Deliver a luxurious, editorial layout with elevated metallic detailing and intimate spotlighting.',
  },
  [StyleOption.Modern]: {
    subtitle: 'Bold geometrics with crisp lighting and high contrast.',
    talkingPoints: [
      'Inspired by tech keynote splash screens and futurist posters.',
      'Pair punchy sans-serifs with diagonal cuts and modular grids.',
      'Play with neon glows, deep shadows, and asymmetry.',
    ],
    aiHint: 'Create an avant-garde, high-contrast composition with geometric overlays and futuristic motion cues.',
  },
  [StyleOption.Friendly]: {
    subtitle: 'Rounded lettering, warm tones, and playful stickers.',
    talkingPoints: [
      'Channel illustrated scrapbooks and joyful community boards.',
      'Use handwritten or bubbly fonts with sticker-like callouts.',
      'Include confetti, playful doodles, and warm sunshine palettes.',
    ],
    aiHint: 'Deliver a cheerful, handcrafted layout with sticker motifs, warm colors, and lively motion.',
  },
  [StyleOption.Sporty]: {
    subtitle: 'Dynamic angles with motion streaks and neon highlights.',
    talkingPoints: [
      'Reference racing posters and performance car commercials.',
      'Tilt typography, add motion blur, and spotlight velocity.',
      'Electric blues, reds, and neon accents keep energy high.',
    ],
    aiHint: 'Produce an aggressive, high-energy layout bursting with motion trails, angled type, and glowing accents.',
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

type CaptionSource = 'ai' | 'prompted' | 'template' | 'custom';

const AI_FLAVORS = [
  { id: 'hero', label: 'Spotlight Moment', description: 'Lean into the triumph of the delivery and make the customer feel like a star.' },
  { id: 'story', label: 'Mini Story', description: 'Tell a short, cinematic story about their journey to this new ride.' },
  { id: 'community', label: 'Dealership Family', description: 'Celebrate the relationship with the team and invite others to join the family.' },
];

interface StyleCardProps {
  option: StyleOption;
  current: StyleOption;
  onSelect: (option: StyleOption) => void;
}

const StyleCard: React.FC<StyleCardProps> = ({ option, current, onSelect }) => {
  const meta = STYLE_GUIDES[option];
  const isActive = option === current;

  return (
    <button
      onClick={() => {
        triggerHapticFeedback();
        onSelect(option);
      }}
      className={`group flex flex-col gap-3 rounded-2xl border px-4 py-5 text-left transition-all duration-200 ${
        isActive ? 'border-indigo-400 bg-white/10 shadow-lg shadow-indigo-500/30' : 'border-white/10 bg-white/5 hover:border-indigo-400/70 hover:bg-white/10'
      }`}
    >
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-white">{option}</span>
          {isActive && <Badge variant="success">Selected</Badge>}
        </div>
        <p className="text-xs text-indigo-100/80 leading-relaxed">{meta.subtitle}</p>
        <ul className="space-y-1 text-[11px] text-indigo-100/70">
          {meta.talkingPoints.map(point => (
            <li key={point} className="flex gap-2">
              <span className="mt-1 block h-1 w-1 rounded-full bg-indigo-400"></span>
              <span>{point}</span>
            </li>
          ))}
        </ul>
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
  isDesktopLayout,
}) => {
  const [customerName, setCustomerName] = useState('');
  const [style, setStyle] = useState<StyleOption>(defaultStyle);
  const [tone, setTone] = useState<ToneOption>(defaultTone);
  const [customMessage, setCustomMessage] = useState('');
  const [captionSource, setCaptionSource] = useState<CaptionSource>('ai');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiFlavor, setAiFlavor] = useState(AI_FLAVORS[0].id);
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

  useEffect(() => {
    if (captionSource !== 'prompted') {
      setAiPrompt('');
    }
  }, [captionSource]);

  const templateOptions = useMemo(() => POST_TEMPLATES, []);

  useEffect(() => {
    if (templateOptions.length > 0 && !selectedTemplateId) {
      setSelectedTemplateId(templateOptions[0].id);
    }
  }, [templateOptions, selectedTemplateId]);

  const selectedStyleGuide = STYLE_GUIDES[style];

  const handleGenerate = useCallback(() => {
    triggerHapticFeedback();
    let preparedText: string | undefined;
    let creativeBrief: string | undefined;

    const styleBriefSections: string[] = [];
    if (selectedStyleGuide) {
      styleBriefSections.push(`Design DNA: ${selectedStyleGuide.aiHint}`);
      if (selectedStyleGuide.talkingPoints.length > 0) {
        styleBriefSections.push('Execution pillars:');
        styleBriefSections.push(...selectedStyleGuide.talkingPoints.map((point) => `- ${point}`));
      }
    }
    const baseStyleBrief = styleBriefSections.join('\n');

    if (captionSource === 'template') {
      const template = templateOptions.find((tpl) => tpl.id === selectedTemplateId);
      if (template) {
        preparedText = template.content
          .replace(/\[Customer Name\]/g, customerName.trim() || 'our amazing customer')
          .replace(/\[Dealership Name\]/g, dealershipName);
      }
      creativeBrief = baseStyleBrief || undefined;
    } else if (captionSource === 'custom') {
      preparedText = customMessage.trim() || undefined;
      creativeBrief = baseStyleBrief || undefined;
    } else if (captionSource === 'prompted') {
      const userPrompt = aiPrompt.trim();
      creativeBrief = [baseStyleBrief, userPrompt ? `Custom prompt: ${userPrompt}` : undefined]
        .filter(Boolean)
        .join('\n\n') || undefined;
    } else {
      const flavor = AI_FLAVORS.find((flavor) => flavor.id === aiFlavor);
      creativeBrief = [baseStyleBrief, flavor ? `AI storytelling focus: ${flavor.description}` : undefined]
        .filter(Boolean)
        .join('\n\n') || undefined;
    }

    onGenerate(style, tone, customerName, preparedText, creativeBrief);
  }, [captionSource, tone, style, customerName, customMessage, dealershipName, onGenerate, selectedTemplateId, templateOptions, aiPrompt, aiFlavor, selectedStyleGuide]);

  return (
    <div className="w-full max-w-6xl mx-auto px-1 sm:px-0">
      <Card className="overflow-hidden">
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
          <div className={`grid gap-6 ${isDesktopLayout ? 'lg:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]' : ''}`}>
            <div className="space-y-6">
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
                  <h4 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Design direction</h4>
                </div>
                <div className={`grid gap-3 ${isDesktopLayout ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'}`}>
                  {Object.values(StyleOption).map((option) => (
                    <StyleCard key={option} option={option} current={style} onSelect={setStyle} />
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <h4 className="text-sm font-semibold uppercase tracking-wide text-indigo-200">Caption strategy</h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Button
                    variant={captionSource === 'ai' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => { triggerHapticFeedback(); setCaptionSource('ai'); }}
                  >
                    <Icon type="sparkles" className="h-4 w-4" />
                    <span>AI Auto-Magic</span>
                  </Button>
                  <Button
                    variant={captionSource === 'prompted' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => { triggerHapticFeedback(); setCaptionSource('prompted'); }}
                  >
                    <Icon type="edit" className="h-4 w-4" />
                    <span>AI Remix</span>
                  </Button>
                  <Button
                    variant={captionSource === 'template' ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => { triggerHapticFeedback(); setCaptionSource('template'); }}
                  >
                    <Icon type="settings" className="h-4 w-4" />
                    <span>Templates</span>
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
                  <div className="space-y-4">
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.values(ToneOption).map((option) => (
                        <ToneTile key={option} tone={option} current={tone} onSelect={setTone} />
                      ))}
                    </div>
                    <div className="space-y-2">
                      <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Tell the AI what to emphasize</span>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {AI_FLAVORS.map(({ id, label, description }) => (
                          <button
                            key={id}
                            onClick={() => { triggerHapticFeedback(); setAiFlavor(id); }}
                            className={`rounded-lg border px-3 py-2 text-left text-xs transition-all ${aiFlavor === id ? 'border-indigo-400 bg-indigo-500/25 text-white shadow' : 'border-white/10 bg-white/5 text-indigo-100 hover:border-indigo-400/40'}`}
                          >
                            <span className="font-semibold block text-sm">{label}</span>
                            <span className="text-[11px] leading-relaxed text-indigo-100/80">{description}</span>
                          </button>
                        ))}
                      </div>
                    </div>
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

                {captionSource === 'prompted' && (
                  <label className="flex flex-col gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Describe the vibe you want</span>
                    <textarea
                      value={aiPrompt}
                      onChange={(event) => setAiPrompt(event.target.value)}
                      rows={4}
                      className="min-h-[120px] rounded-lg border border-white/10 bg-slate-900/60 px-4 py-3 text-sm text-white placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
                      placeholder="e.g., Celebrate how they found their dream off-road rig and shout out the weekend adventures ahead."
                    />
                  </label>
                )}

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
                  <Button
                    size="lg"
                    onClick={handleGenerate}
                    disabled={!isApiKeyConfigured || (captionSource === 'prompted' && !aiPrompt.trim())}
                  >
                    <Icon type="check" className="h-5 w-5" />
                    {isApiKeyConfigured ? 'Generate hero image & caption' : 'Add API key to generate'}
                  </Button>
                </div>
              </div>
            </div>

            <aside className="space-y-4">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/60">
                <img src={imageSrc} alt="Captured reference" className="h-full w-full object-cover" />
              </div>
              <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Style playbook</span>
                  <Badge variant="info">{style}</Badge>
                </div>
                <p className="text-sm text-indigo-100/85 leading-relaxed">{selectedStyleGuide.subtitle}</p>
                <ul className="space-y-2 text-[12px] text-indigo-100/70">
                  {selectedStyleGuide.talkingPoints.map((point) => (
                    <li key={point} className="flex gap-2">
                      <span className="mt-1 block h-1.5 w-1.5 rounded-full bg-indigo-400/80"></span>
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
                <div className="rounded-xl border border-indigo-400/30 bg-indigo-500/10 px-3 py-2 text-[12px] text-indigo-100/80">
                  <strong className="block text-indigo-200 text-xs uppercase tracking-wide">AI brief</strong>
                  <span>{selectedStyleGuide.aiHint}</span>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-4">
                <span className="text-xs font-semibold uppercase tracking-wide text-indigo-200">Tone focus</span>
                <p className="mt-2 text-sm text-indigo-100/80">{TONE_DESCRIPTIONS[tone]}</p>
              </div>
            </aside>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
