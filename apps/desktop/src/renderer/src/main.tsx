import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { queryClient } from './lib/api';
import { App } from './App';
import './index.css';

// A library scan builds thumbnails on the process that delivers keystrokes. Tell it to wait while someone is typing.
window.addEventListener('keydown', () => window.api?.app.noteActivity(), true);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
