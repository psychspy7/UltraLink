import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'UltraLink — Ultrasonic Acoustic Data Bridge',
    short_name: 'UltraLink',
    description: 'Near-ultrasonic device-to-device communication PWA operating 100% offline.',
    start_url: '/',
    display: 'standalone',
    background_color: '#070B14',
    theme_color: '#06B6D4',
    orientation: 'portrait-primary',
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
    categories: ['utilities', 'communication', 'productivity'],
  };
}
