'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Radio,
  FileDown,
  Ear,
  Clock,
  Activity,
  Wifi,
  WifiOff,
  ShieldCheck,
} from 'lucide-react';

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  shortName: string;
}

const NAV_ITEMS: NavItem[] = [
  { name: 'Transmit', href: '/transmit', icon: Radio, shortName: 'TX' },
  { name: 'Receive File', href: '/receive-file', icon: FileDown, shortName: 'RX File' },
  { name: 'Live Listen', href: '/live-listen', icon: Ear, shortName: 'Live' },
  { name: 'History', href: '/history', icon: Clock, shortName: 'History' },
  { name: 'Diagnostics', href: '/diagnostics', icon: Activity, shortName: 'Diag' },
];

export const Navigation: React.FC = () => {
  const pathname = usePathname();
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsOnline(navigator.onLine);
      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
    }
  }, []);

  return (
    <>
      {/* Top Header Bar for Desktop / Tablet */}
      <header className="sticky top-0 z-40 w-full border-b border-cyan-500/20 bg-[#070B14]/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          {/* Logo & Brand */}
          <Link href="/transmit" className="flex items-center space-x-3 group">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-cyan-500 to-teal-600 flex items-center justify-center p-0.5 shadow-lg shadow-cyan-500/20 group-hover:shadow-cyan-500/40 transition-shadow">
              <div className="w-full h-full bg-[#070B14] rounded-[7px] flex items-center justify-center">
                <Radio className="w-5 h-5 text-cyan-400 group-hover:scale-110 transition-transform" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg tracking-wider text-slate-100 flex items-center gap-1.5">
                ULTRA<span className="text-cyan-400">LINK</span>
                <span className="text-[10px] uppercase font-mono px-1.5 py-0.5 rounded bg-cyan-950/80 text-cyan-400 border border-cyan-500/30">
                  PWA
                </span>
              </span>
              <span className="text-[11px] text-slate-400 font-mono -mt-1 hidden sm:block">
                Near-Ultrasonic Acoustic Link
              </span>
            </div>
          </Link>

          {/* Desktop Nav Items */}
          <nav className="hidden md:flex items-center space-x-1 lg:space-x-2">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || (item.href === '/transmit' && pathname === '/');
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm shadow-cyan-500/20'
                      : 'text-slate-300 hover:text-cyan-300 hover:bg-slate-800/40'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                  <span>{item.name}</span>
                </Link>
              );
            })}
          </nav>

          {/* Right Action / Status Badges */}
          <div className="flex items-center space-x-3">
            {/* Offline-First Badge */}
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${
                isOnline
                  ? 'bg-emerald-950/40 text-emerald-400 border-emerald-500/30'
                  : 'bg-amber-950/40 text-amber-400 border-amber-500/30'
              }`}
              title={isOnline ? 'Online (PWA Offline-Ready)' : 'Operating 100% Offline'}
            >
              {isOnline ? (
                <>
                  <Wifi className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">OFFLINE READY</span>
                </>
              ) : (
                <>
                  <WifiOff className="w-3.5 h-3.5" />
                  <span>OFFLINE MODE</span>
                </>
              )}
            </div>

            {/* Ultrasonic Protocol Badge */}
            <div className="hidden lg:flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-mono bg-cyan-950/40 text-cyan-400 border border-cyan-500/30">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>17.0–19.0 kHz</span>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#070B14]/95 backdrop-blur-lg border-t border-cyan-500/20 px-2 py-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-2xl">
        <div className="flex items-center justify-around">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href === '/transmit' && pathname === '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center py-1 px-2 rounded-lg text-[11px] font-medium transition-all ${
                  isActive
                    ? 'text-cyan-400'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <div
                  className={`p-1 rounded-lg ${
                    isActive ? 'bg-cyan-500/20 text-cyan-400 ring-1 ring-cyan-500/40' : ''
                  }`}
                >
                  <Icon className="w-5 h-5" />
                </div>
                <span className="mt-0.5 tracking-tight">{item.shortName}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
};

export default Navigation;
