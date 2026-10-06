import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PredictiveArcCanvasWrapper } from '@/components/threeui/PredictiveArcCanvasWrapper';
import { Navigation } from '@/components/layout/Navigation';
import { ServiceWorkerRegistrar } from '@/components/layout/ServiceWorkerRegistrar';

export const metadata: Metadata = {
  title: 'UltraLink — Near-Ultrasonic Acoustic Communication PWA',
  description:
    'Device-to-device acoustic data transmission using standard Web Audio APIs (17.0–19.0 kHz). 100% offline.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/favicon.ico',
  },
};

export const viewport: Viewport = {
  themeColor: '#06B6D4',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className="h-full bg-[#070B14] text-slate-100 flex flex-col selection:bg-cyan-500/30 selection:text-cyan-200 overflow-x-hidden min-w-0">
        {/* Dynamic ThreeUI PredictiveArcCanvas background */}
        <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden" aria-hidden="true">
          <PredictiveArcCanvasWrapper
            variant="void-field"
            hue={205}
            saturation={0.9}
            brightness={0.65}
            speed={1.0}
            className="w-full h-full opacity-65"
          />
        </div>

        {/* PWA Service Worker Registration */}
        <ServiceWorkerRegistrar />

        {/* Navigation Bar */}
        <Navigation />

        {/* Main Content Area */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28 md:pb-12 min-w-0 relative z-10">
          {children}
        </main>
      </body>
    </html>
  );
}
