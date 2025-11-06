import './styles/globals.css';
import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { getQueryClient } from './services/queryClient';

const ReactQueryDevtools = React.lazy(() =>
  import('@tanstack/react-query-devtools').then((mod) => ({ default: mod.ReactQueryDevtools }))
);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <QueryClientProvider client={getQueryClient()}>
      <App />
      {import.meta.env.DEV && (
        <Suspense fallback={null}>
          <ReactQueryDevtools initialIsOpen={false} />
        </Suspense>
      )}
    </QueryClientProvider>
  </React.StrictMode>
);
