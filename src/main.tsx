import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

// The Studio must never be served from an offline cache: evict any service
// worker previously registered on this origin (the Studio was briefly built
// as a PWA) so a dead API can no longer masquerade as a working app.
if ('serviceWorker' in navigator) {
  void navigator.serviceWorker.getRegistrations().then((registrations) => {
    for (const registration of registrations) void registration.unregister();
  });
  if (window.caches) {
    void window.caches.keys().then((keys) => {
      for (const key of keys) void window.caches.delete(key);
    });
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
