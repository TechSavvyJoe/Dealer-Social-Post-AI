# 🚗 Dealership AI Sales Coach Suite

An enterprise-grade AI-powered sales coaching application for automotive dealerships, featuring real-time conversation analysis, performance tracking, and team management capabilities. Built with React, TypeScript, and Google Gemini AI.

## ✨ Features

### For Salespeople
- 🎙️ **Real-time Sale Recording** - Record live sales with live audio visualization
- 🤖 **AI Coaching Alerts** - Get instant feedback and suggestions during sales
- 📊 **Performance Analytics** - Detailed AI-generated reports on sales techniques
- 📋 **Pre-sale Briefing** - AI-powered customer insights before meetings
- 📚 **Sales History** - Track and review past sales with searchable archive
- 🎯 **Success Tracking** - Real-time probability indicators and sentiment analysis

### For Managers
- 👀 **Live Sale Monitoring** - View all active sales interactions in real-time
- 📈 **Team Performance Dashboard** - Track team metrics and success rates
- 🔍 **Individual Sale Details** - Deep-dive into any live or recorded sale
- 🔄 **Cross-tab Sync** - Monitor sales across multiple browser windows
- 📉 **Performance Analytics** - Team-wide insights and comparisons

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Google Gemini API key ([Get one here](https://makersuite.google.com/app/apikey))

### Installation

1. Install dependencies:
```bash
npm install
```

2. Set up environment variables:
Create a `.env.local` file:
```env
VITE_GEMINI_API_KEY=your_api_key_here
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3000](http://localhost:3000) 🎉

## 🛠️ Tech Stack

- **Frontend**: React 19, TypeScript 5.8
- **Build Tool**: Vite 6.2
- **Styling**: Tailwind CSS 3 + Custom Design System
- **Animations**: Framer Motion
- **State**: Zustand
- **Routing**: React Router v6
- **Charts**: Recharts
- **Icons**: Lucide React
- **AI**: Google Gemini (2.5 Pro, 2.5 Flash)

## 🎨 Design System

Enterprise-quality UI following Apple/Google/Microsoft standards:
- Custom design tokens for consistent theming
- Dark/Light/System theme support with `Ctrl+T`
- Glassmorphism effects and smooth animations
- Fully accessible and responsive
- Professional color palette and typography

## 📁 Project Structure

```
src/
├── components/
│   ├── ui/              # Base components (Button, Card, Input, etc.)
│   ├── features/        # Feature components (AudioWaveform, RecordingControls, etc.)
│   └── layout/          # Layout components
├── pages/               # Route pages (Login, Dashboards)
├── stores/              # Zustand state (auth, theme, sale, ui)
├── services/            # API & business logic (Gemini, storage, realtime)
├── hooks/               # Custom hooks (audioRecorder, keyboardShortcuts)
├── lib/                 # Utils (design tokens, audio utils)
├── config/              # App configuration
└── types/               # TypeScript definitions
```

## 🎯 Key Features Explained

### Audio Recording System
- Web Audio API with real-time processing
- Live audio level monitoring (10-bar meter)
- Visual waveform display (40 animated bars)
- PCM16 encoding for AI analysis

### AI Integration
- **Gemini 2.5 Pro** - Detailed performance analysis
- **Gemini 2.5 Flash** - Real-time coaching
- 6-step sales process analysis
- Sentiment detection & success probability

### Real-time Manager Monitoring
- localStorage events for cross-tab sync
- Auto-refresh every 2 seconds
- Live transcript streaming
- Click-to-view detailed sale analysis

## ⌨️ Keyboard Shortcuts

- `Ctrl/Cmd + T` - Toggle theme
- `Enter` - Submit forms / Start actions
- `Escape` - Close modals

## 🎭 Theme Support

Three beautiful themes:
- ☀️ **Light** - Clean and professional
- 🌙 **Dark** - Easy on the eyes
- 💻 **System** - Matches your OS

## 🌐 Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

## 🏗️ Build for Production

```bash
npm run build
```

Output in `dist/` directory, ready to deploy!

## 🔒 Security & Privacy

- ✅ All data stored losaley (localStorage)
- ✅ No backend server required
- ✅ Client-side audio processing
- ✅ API keys in environment variables

## 🚀 Performance

- Code splitting with React Router
- Lazy loading components
- Memoized calculations
- Debounced inputs
- Optimized re-renders

## ♿ Accessibility

- ARIA labels on all interactive elements
- Full keyboard navigation
- Proper focus management
- WCAG color contrast compliance
- Screen reader friendly

## 📦 Available Scripts

```bash
npm run dev          # Start dev server
npm run build        # Production build
npm run preview      # Preview production build
npm run type-check   # TypeScript checking
npm run lint         # ESLint
```

## 🤝 Contributing

This is a production-ready application. Follow existing patterns:
- TypeScript strict mode
- Proper error handling
- Accessibility first
- Test across browsers

## 📄 License

Proprietary - All rights reserved

---

**Built with ❤️ using React, TypeScript, and Google Gemini AI**

View original in AI Studio: https://ai.studio/apps/drive/1dDYABNGf6HQLJX4V9q8hhpwvE2TauANY
