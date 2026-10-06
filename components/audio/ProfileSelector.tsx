'use client';

import React from 'react';
import { PROFILES, ProfileId, ModulationProfile } from '@/lib/dsp/profiles';
import { Shield, Zap, Flame, Cpu, CheckCircle } from 'lucide-react';

interface ProfileSelectorProps {
  selectedProfileId: ProfileId;
  onSelectProfile: (profile: ModulationProfile) => void;
  disabled?: boolean;
}

const PROFILE_ICONS: Record<ProfileId, React.ComponentType<{ className?: string }>> = {
  reliable: Shield,
  balanced: Zap,
  fast: Flame,
  experimental: Cpu,
};

export const ProfileSelector: React.FC<ProfileSelectorProps> = ({
  selectedProfileId,
  onSelectProfile,
  disabled = false,
}) => {
  const profileList = Object.values(PROFILES);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="text-sm font-semibold text-slate-200">
          Modulation Profile
        </label>
        <span className="text-xs text-slate-400 font-mono">
          17.0 kHz – 19.0 kHz Acoustic FSK
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {profileList.map((p) => {
          const isSelected = selectedProfileId === p.id;
          const Icon = PROFILE_ICONS[p.id] || Zap;

          return (
            <button
              key={p.id}
              type="button"
              disabled={disabled}
              onClick={() => onSelectProfile(p)}
              className={`relative text-left p-3.5 rounded-xl border transition-all ${
                isSelected
                  ? 'bg-cyan-950/40 border-cyan-400 ring-1 ring-cyan-400 shadow-md shadow-cyan-500/10'
                  : 'bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-800/40'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
            >
              {isSelected && (
                <div className="absolute top-2.5 right-2.5 text-cyan-400">
                  <CheckCircle className="w-4 h-4 fill-cyan-400/20" />
                </div>
              )}

              <div className="flex items-center space-x-2.5 mb-2">
                <div
                  className={`p-1.5 rounded-lg ${
                    isSelected
                      ? 'bg-cyan-500/20 text-cyan-400'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-100">{p.name}</h4>
                  <span className="text-[11px] font-mono text-cyan-400/90 uppercase">
                    {p.scheme}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-400 mb-3 line-clamp-2">
                {p.description}
              </p>

              <div className="pt-2 border-t border-slate-800/80 grid grid-cols-2 gap-1 text-[11px] font-mono text-slate-300">
                <div>
                  <span className="text-slate-500">Speed:</span> ~{p.nominalBitrateBps} bps
                </div>
                <div>
                  <span className="text-slate-500">Symbol:</span> {p.symbolDurationMs} ms
                </div>
                <div>
                  <span className="text-slate-500">Spacing:</span> {p.freqSpacing} Hz
                </div>
                <div>
                  <span className="text-slate-500">Max Chunk:</span> {p.maxPayloadBytes} B
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ProfileSelector;
