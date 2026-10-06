'use client';

import React, { useState, useRef, useEffect } from 'react';
import Header from '@/components/layout/Header';
import ProfileSelector from '@/components/audio/ProfileSelector';
import AudioVisualizer from '@/components/audio/AudioVisualizer';
import { PROFILES, ModulationProfile, DEFAULT_PROFILE, ProfileId } from '@/lib/dsp/profiles';
import { encodeTextToAudioBuffer } from '@/lib/dsp/modulation';
import { encodeTextToWav } from '@/lib/dsp/wav';
import { chunkText } from '@/lib/dsp/framing';
import { saveMessageRecord } from '@/components/storage/historyVault';
import {
  Play,
  Square,
  Download,
  Sparkles,
  Volume2,
  Layers,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

const PRESETS = [
  { label: 'Short Test', text: 'ULTRALINK:OK' },
  { label: 'Emoji Greeting', text: 'Hello World 🚀🔊' },
  { label: 'Unicode Kanji', text: '超音波通信 2026' },
  { label: 'Max Single Chunk', text: 'Acoustic air-gapped data bridge protocol.' },
];

export default function TransmitPage() {
  const [text, setText] = useState<string>('Hello from UltraLink! 🔊');
  const [profile, setProfile] = useState<ModulationProfile>(DEFAULT_PROFILE);
  const [volume, setVolume] = useState<number>(0.8);
  const [isTransmitting, setIsTransmitting] = useState<boolean>(false);
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [statusText, setStatusText] = useState<string>('Ready to transmit');
  const [lastWavDownloaded, setLastWavDownloaded] = useState<boolean>(false);
  const [generatedBuffer, setGeneratedBuffer] = useState<Float32Array | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const timerRef = useRef<number | null>(null);

  // Compute UTF-8 byte count
  const utf8Bytes = typeof window !== 'undefined' ? new TextEncoder().encode(text).length : text.length;
  // Compute chunk count
  const packets = chunkText(text, profile);
  const totalChunks = packets.length;

  useEffect(() => {
    return () => {
      stopTransmission();
    };
  }, []);

  const stopTransmission = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
      } catch {
        // Already stopped
      }
      currentSourceRef.current = null;
    }
    setIsTransmitting(false);
    setProgressPercent(0);
    setStatusText('Transmission stopped');
  };

  const handleTransmit = async () => {
    if (!text.trim()) return;
    stopTransmission();

    try {
      setStatusText('Synthesizing ultrasonic carrier...');
      setIsTransmitting(true);
      setProgressPercent(5);

      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioContextRef.current) {
        audioContextRef.current = new AudioCtxClass();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const sampleRate = ctx.sampleRate;
      // Synthesize tone buffer
      const rawSamples = encodeTextToAudioBuffer(text, profile, sampleRate);
      setGeneratedBuffer(rawSamples);

      const audioBuffer = ctx.createBuffer(1, rawSamples.length, sampleRate);
      audioBuffer.getChannelData(0).set(rawSamples);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;

      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(volume, ctx.currentTime);

      source.connect(gainNode);
      gainNode.connect(ctx.destination);

      currentSourceRef.current = source;

      const durationSeconds = rawSamples.length / sampleRate;
      const startTime = Date.now();
      setStatusText(`Broadcasting (${(profile.baseFreq / 1000).toFixed(1)}–${((profile.baseFreq + profile.bandwidthHz) / 1000).toFixed(1)} kHz)...`);

      // Track progress
      const interval = window.setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const pct = Math.min(100, Math.round((elapsed / durationSeconds) * 100));
        setProgressPercent(pct);
        if (pct >= 100) {
          clearInterval(interval);
        }
      }, 50);
      timerRef.current = interval;

      source.onended = () => {
        clearInterval(interval);
        setIsTransmitting(false);
        setProgressPercent(100);
        setStatusText('Transmission complete');
        currentSourceRef.current = null;

        // Save to offline history vault
        saveMessageRecord({
          id: `tx_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          direction: 'sent',
          text,
          timestamp: Date.now(),
          payloadLength: utf8Bytes,
          profileUsed: profile.name,
          status: 'delivered',
          crcPassed: true,
          durationMs: Math.round(durationSeconds * 1000),
          sampleRate,
        });
      };

      source.start();
    } catch (err) {
      console.error('Transmission error:', err);
      setIsTransmitting(false);
      setStatusText(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleDownloadWav = () => {
    if (!text.trim()) return;
    try {
      const sampleRate = 48000;
      const wavBytes = encodeTextToWav(text, profile, sampleRate);
      setGeneratedBuffer(encodeTextToAudioBuffer(text, profile, sampleRate));

      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ultralink_tx_${Date.now()}_${profile.id}.wav`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setLastWavDownloaded(true);
      setTimeout(() => setLastWavDownloaded(false), 3000);

      // Save to offline history vault
      saveMessageRecord({
        id: `wav_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        direction: 'sent',
        text,
        timestamp: Date.now(),
        payloadLength: utf8Bytes,
        profileUsed: `${profile.name} (WAV Export)`,
        status: 'delivered',
        crcPassed: true,
        durationMs: Math.round((wavBytes.length / (sampleRate * 2)) * 1000),
        sampleRate,
      });
    } catch (err) {
      console.error('WAV export error:', err);
      alert(`WAV export failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      <Header
        title="Acoustic Transmitter"
        subtitle="Encode Unicode, emoji, and binary payloads into near-ultrasonic sound waves for speaker broadcast or WAV file export."
        badge="TX Core"
      />

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Message Composer & Profile Selector */}
        <div className="lg:col-span-2 space-y-6">
          {/* Message Composer Card */}
          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <label htmlFor="message-input" className="text-sm font-semibold text-slate-200">
                Message Content
              </label>
              <div className="flex items-center space-x-3 text-xs font-mono text-slate-400">
                <span>{text.length} chars</span>
                <span className="text-cyan-400 font-bold">{utf8Bytes} UTF-8 bytes</span>
                <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                  {totalChunks} {totalChunks === 1 ? 'packet' : 'packets'}
                </span>
              </div>
            </div>

            <textarea
              id="message-input"
              rows={4}
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={isTransmitting}
              placeholder="Enter message to transmit over acoustic link..."
              className="w-full rounded-xl bg-slate-950/80 border border-slate-700/80 p-3.5 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400 font-mono transition-all resize-y min-h-[100px]"
            />

            {/* Quick Presets */}
            <div className="space-y-2">
              <span className="text-xs text-slate-400 flex items-center gap-1 font-mono">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400" /> Quick Presets:
              </span>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => setText(preset.text)}
                    disabled={isTransmitting}
                    className="px-2.5 py-1 text-xs rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-cyan-300 border border-slate-700/60 transition-all font-mono"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Profile Selector */}
          <div className="glass-panel rounded-2xl p-5">
            <ProfileSelector
              selectedProfileId={profile.id}
              onSelectProfile={(p) => setProfile(p)}
              disabled={isTransmitting}
            />
          </div>
        </div>

        {/* Right Column: Visualizer, Volume & Actions */}
        <div className="space-y-6">
          {/* Transmission Status & Visualizer Card */}
          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center justify-between">
              <span>Waveform Monitor</span>
              <span className="text-[11px] font-mono text-cyan-400">{profile.name} Mode</span>
            </h3>

            {/* Audio Waveform */}
            <AudioVisualizer
              isTransmitting={isTransmitting}
              progressPercent={progressPercent}
              audioBuffer={generatedBuffer}
              statusText={statusText}
            />

            {/* Volume Control */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs font-mono text-slate-300">
                <span className="flex items-center gap-1.5">
                  <Volume2 className="w-4 h-4 text-cyan-400" /> Transmission Amplitude
                </span>
                <span className="font-bold text-cyan-400">{Math.round(volume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.05"
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                disabled={isTransmitting}
                className="w-full accent-cyan-400 h-1.5 bg-slate-800 rounded-lg cursor-pointer"
              />
              {volume < 0.5 && (
                <p className="text-[11px] text-amber-400/90 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Low volume may reduce acoustic range.
                </p>
              )}
            </div>

            {/* Action Buttons */}
            <div className="space-y-2.5 pt-2">
              {!isTransmitting ? (
                <button
                  type="button"
                  onClick={handleTransmit}
                  disabled={!text.trim()}
                  className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-bold text-sm shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>Transmit Sound (Speaker)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopTransmission}
                  className="w-full py-3.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-sm shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Square className="w-4 h-4 fill-white" />
                  <span>Stop Transmission</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleDownloadWav}
                disabled={isTransmitting || !text.trim()}
                className="w-full py-3 px-4 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-cyan-500/30 hover:border-cyan-400 font-semibold text-sm transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {lastWavDownloaded ? (
                  <>
                    <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-400">WAV Exported!</span>
                  </>
                ) : (
                  <>
                    <Download className="w-4 h-4 text-cyan-400" />
                    <span>Download WAV File (16-bit PCM)</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Packet Protocol Telemetry Info */}
          <div className="glass-panel rounded-2xl p-4 text-xs font-mono text-slate-400 space-y-2">
            <div className="flex items-center gap-1.5 text-slate-300 font-bold">
              <Layers className="w-4 h-4 text-cyan-400" /> Framing Parameters
            </div>
            <div className="grid grid-cols-2 gap-1.5 pt-1 text-[11px]">
              <div>Preamble: Linear Chirp</div>
              <div>Sync: Barker-13</div>
              <div>Header: 8B (CRC8)</div>
              <div>Trailer: 4B (CRC32)</div>
              <div>Carrier: 17.0–19.0 kHz</div>
              <div>Deduplication: Active</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
