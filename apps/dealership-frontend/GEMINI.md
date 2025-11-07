# GEMINI.md

## Project Overview

This is a feature-rich, enterprise-grade AI-powered sales coaching application for automotive dealerships. It is built with React, TypeScript, and Google Gemini AI. The application provides real-time conversation analysis, performance tracking, and team management capabilities.

The application has two main user roles:
- **Salespeople:** Can record sales conversations, receive real-time AI coaching alerts, view performance analytics, and manage their sales history.
- **Managers:** Can monitor live sales, view a team performance dashboard, and deep-dive into individual sales.

The application is a single-page application (SPA) built with modern web technologies. It uses Vite for the build tool, Tailwind CSS for styling, and Zustand for state management. The application is designed to be fully client-side, with all data stored in the browser's `localStorage`.

## Building and Running

### Prerequisites

- Node.js 18+ and npm
- Google Gemini API key

### Installation

1.  Install dependencies:
    ```bash
    npm install
    ```

2.  Set up environment variables:
    Create a `.env.local` file in the root of the project and add your Gemini API key:
    ```env
    VITE_GEMINI_API_KEY=your_api_key_here
    ```

3.  Start the development server:
    ```bash
    npm run dev
    ```

4.  Open [http://localhost:3000](http://localhost:3000) in your browser.

### Available Scripts

- `npm run dev`: Start the development server.
- `npm run build`: Build the application for production.
- `npm run preview`: Preview the production build.
- `npm run lint`: Lint the codebase using ESLint.
- `npm run type-check`: Check for TypeScript errors.
- `npm run format`: Check for formatting errors with Prettier.

## Development Conventions

- **TypeScript:** The project is written in TypeScript and uses strict mode.
- **Styling:** The project uses Tailwind CSS for styling. Custom design tokens are defined in `src/lib/design-tokens.ts`.
- **State Management:** The project uses Zustand for state management. Stores are located in the `src/stores` directory.
- **Routing:** The project uses React Router for routing. The main routing logic is in `src/App.tsx`.
- **API Integration:** The project interacts with the Google Gemini API. The API logic is located in `src/services/geminiService.ts`.
- **Error Handling:** The project uses a custom `ErrorBoundary` component to catch and handle errors.
- **Accessibility:** The project is designed to be fully accessible, with ARIA labels, full keyboard navigation, and proper focus management.
