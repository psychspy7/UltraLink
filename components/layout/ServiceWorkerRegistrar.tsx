'use client';

import { useEffect } from 'react';

export const ServiceWorkerRegistrar: React.FC = () => {
  useEffect(() => {
    if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          // Successfully registered
          if (process.env.NODE_ENV !== 'production') {
            console.log('[UltraLink PWA] Service worker registered with scope:', registration.scope);
          }
        })
        .catch((err) => {
          console.warn('[UltraLink PWA] Service worker registration failed:', err);
        });
    }
  }, []);

  return null;
};

export default ServiceWorkerRegistrar;
