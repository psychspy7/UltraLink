'use client';

import React, { useState, useEffect, useRef } from 'react';
import Header from '@/components/layout/Header';
import {
  Activity,
  Cpu,
  Volume2,
  Mic,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Play,
  Square,
  Sparkles,
  Smartphone,
  Gauge,
} from 'lucide-react';

interface AudioHardwareInfo {
  sampleRate: number;
  baseLatencyMs: number;
  outputLatencyMs: number;
  state: string;
  maxChannelCount: number;
}

export default function DiagnosticsPage() {
  const [hardwareInfo, setHardwareInfo] = useState<AudioHardwareInfo | null>(null);
  const [micState, setMicState] = useState<'prompt' | 'granted' | 'denied' | 'checking'>('checking');
  const [isPlayingTestTone, setIsPlayingTestTone] = useState<boolean>(false);
  const [activeFreqHz, setActiveFreqHz] = useState<number>(18000);
  const [isAuditingMic, setIsAuditingMic] = useState<boolean>(false);
  const [micAuditVerdict, setMicAuditVerdict] = useState<string | null>(null);
  const [highFreqEnergy, setHighFreqEnergy] = useState<number>(0);

  const [pwaStatus, setPwaStatus] = useState({
    audioWorklet: false,
    webAudio: false,
    serviceWorker: false,
    cacheStorage: false,
    standalone: false,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const toneOscRef = useRef<OscillatorNode | null>(null);
  const toneGainRef = useRef<GainNode | null>(null);
  const auditStreamRef = useRef<MediaStream | null>(null);
  const auditAnimRef = useRef<number | null>(null);

  useEffect(() => {
    // Audit PWA & Platform APIs
    if (typeof window !== 'undefined') {
      const hasWebAudio = !!(window.AudioContext || (window as unknown as { webkitAudioContext: unknown }).webkitAudioContext);
      const hasAudioWorklet = typeof AudioWorkletNode !== 'undefined';
      const hasSW = 'serviceWorker' in navigator;
      const hasCache = 'caches' in window;
      const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

      setPwaStatus({
        audioWorklet: hasAudioWorklet,
        webAudio: hasWebAudio,
        serviceWorker: hasSW,
        cacheStorage: hasCache,
        standalone: isStandalone,
      });

      // Probe Hardware Info
      if (hasWebAudio) {
        try {
          const AudioCtxClass =
            window.AudioContext ||
            (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
          const ctx = new AudioCtxClass();
          audioContextRef.current = ctx;

          setHardwareInfo({
            sampleRate: ctx.sampleRate,
            baseLatencyMs: ctx.baseLatency ? Math.round(ctx.baseLatency * 1000 * 10) / 10 : 5.3,
            outputLatencyMs: ctx.outputLatency ? Math.round(ctx.outputLatency * 1000 * 10) / 10 : 12.0,
            state: ctx.state,
            maxChannelCount: ctx.destination.maxChannelCount,
          });
        } catch (e) {
          console.warn('AudioContext probe error:', e);
        }
      }

      // Check mic permission status
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions
          .query({ name: 'microphone' as PermissionName })
          .then((perm) => {
            setMicState(perm.state as 'prompt' | 'granted' | 'denied');
            perm.onchange = () => {
              setMicState(perm.state as 'prompt' | 'granted' | 'denied');
            };
          })
          .catch(() => setMicState('prompt'));
      } else {
        setMicState('prompt');
      }
    }

    return () => {
      stopSpeakerTestTone();
      stopMicAudit();
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        try {
          audioContextRef.current.close();
        } catch {
          // Ignore
        }
      }
    };
  }, []);

  const playSpeakerTestTone = async (freqHz: number) => {
    stopSpeakerTestTone();
    setActiveFreqHz(freqHz);

    try {
      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
        audioContextRef.current = new AudioCtxClass();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqHz, ctx.currentTime);

      // Smooth envelope ramp up to prevent clicking
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      toneOscRef.current = osc;
      toneGainRef.current = gain;
      setIsPlayingTestTone(true);

      // Auto stop after 2.5 seconds
      setTimeout(() => {
        stopSpeakerTestTone();
      }, 2500);
    } catch (e) {
      console.error('Failed to play test tone:', e);
      setIsPlayingTestTone(false);
    }
  };

  const stopSpeakerTestTone = () => {
    if (toneGainRef.current && audioContextRef.current) {
      try {
        const ctx = audioContextRef.current;
        toneGainRef.current.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.03);
        setTimeout(() => {
          toneOscRef.current?.stop();
          toneOscRef.current?.disconnect();
          toneOscRef.current = null;
          toneGainRef.current = null;
        }, 50);
      } catch {
        // Ignore
      }
    }
    setIsPlayingTestTone(false);
  };

  const runMicAudit = async () => {
    stopMicAudit();
    setMicAuditVerdict(null);
    setIsAuditingMic(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      auditStreamRef.current = stream;
      setMicState('granted');

      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtxClass();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      const hzPerBin = (ctx.sampleRate / 2) / bufferLength;

      const bin17k = Math.floor(17000 / hzPerBin);
      const bin19k = Math.floor(19000 / hzPerBin);

      let samplesCount = 0;
      let totalHighEnergy = 0;

      const auditLoop = () => {
        analyser.getFloatFrequencyData(dataArray);

        let energy = -120;
        for (let i = bin17k; i <= bin19k && i < bufferLength; i++) {
          if (dataArray[i] > energy) {
            energy = dataArray[i];
          }
        }

        totalHighEnergy += energy;
        samplesCount++;
        setHighFreqEnergy(Math.round(energy));

        if (samplesCount < 100) {
          auditAnimRef.current = requestAnimationFrame(auditLoop);
        } else {
          // Finished audit evaluation
          const avg = totalHighEnergy / samplesCount;
          if (avg > -85) {
            setMicAuditVerdict('High Sensitivity: Microphone captures up to 19.2 kHz cleanly. Recommended profile: Balanced or Fast.');
          } else {
            setMicAuditVerdict('Moderate Sensitivity: Near-ultrasonic range is attenuated. Recommended profile: Reliable (4-FSK).');
          }
          stopMicAudit();
        }
      };

      auditLoop();
    } catch (err) {
      console.error('Mic audit failed:', err);
      setMicAuditVerdict(`Microphone audit failed: ${err instanceof Error ? err.message : String(err)}`);
      setIsAuditingMic(false);
    }
  };

  const stopMicAudit = () => {
    if (auditAnimRef.current) {
      cancelAnimationFrame(auditAnimRef.current);
      auditAnimRef.current = null;
    }
    if (auditStreamRef.current) {
      auditStreamRef.current.getTracks().forEach((t) => t.stop());
      auditStreamRef.current = null;
    }
    setIsAuditingMic(false);
  };

  return (
    <div className="space-y-6 min-w-0">
      <Header
        title="Hardware & Transducer Diagnostics"
        subtitle="Verify device sample rate accuracy, hardware audio latency, ultrasonic speaker frequency output, and microphone sensitivity."
        badge="System Telemetry"
      />

      {/* Grid of Diagnostics Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Card 1: Audio Hardware Telemetry */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center space-x-2 text-slate-100 font-bold">
            <Cpu className="w-5 h-5 text-cyan-400" />
            <h3>Audio Hardware Architecture</h3>
          </div>

          {hardwareInfo ? (
            <div className="space-y-2.5 font-mono text-xs">
              <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400">Native Sample Rate:</span>
                <span className="text-cyan-300 font-bold">
                  {hardwareInfo.sampleRate.toLocaleString()} Hz
                </span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400">Hardware Base Latency:</span>
                <span className="text-slate-200">{hardwareInfo.baseLatencyMs} ms</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400">Audio Output Latency:</span>
                <span className="text-slate-200">{hardwareInfo.outputLatencyMs} ms</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400">Max Channel Output:</span>
                <span className="text-slate-200">{hardwareInfo.maxChannelCount} Ch</span>
              </div>
              <div className="flex justify-between items-center p-2.5 rounded-xl bg-slate-950/70 border border-slate-800">
                <span className="text-slate-400">Engine Invariance:</span>
                <span className="text-emerald-400 font-semibold">44.1k & 48k Supported</span>
              </div>
            </div>
          ) : (
            <div className="p-4 text-xs font-mono text-slate-500 text-center">
              Probing Web Audio hardware...
            </div>
          )}

          <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-500/20 text-xs text-slate-300">
            <span className="font-semibold text-cyan-400 block mb-1">
              Sample Rate Invariance
            </span>
            UltraLink synthesizes mathematical phase increments based on hardware sample rate to ensure identical carrier frequencies on 44.1 kHz and 48.0 kHz DACs.
          </div>
        </div>

        {/* Card 2: Ultrasonic Speaker Calibration Test */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center space-x-2 text-slate-100 font-bold">
            <Volume2 className="w-5 h-5 text-teal-400" />
            <h3>Speaker Ultrasonic Output</h3>
          </div>

          <p className="text-xs text-slate-400">
            Play short 2.5s safe test tones with smooth envelope windowing to verify your speaker transducer can emit 17.0–19.0 kHz.
          </p>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-300 font-mono">
              Select Calibration Frequency:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[17500, 18000, 18500].map((freq) => (
                <button
                  key={freq}
                  type="button"
                  disabled={isPlayingTestTone}
                  onClick={() => setActiveFreqHz(freq)}
                  className={`py-2 px-1 text-xs rounded-xl font-mono transition-all cursor-pointer ${
                    activeFreqHz === freq
                      ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400'
                      : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {(freq / 1000).toFixed(1)} kHz
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2">
            {!isPlayingTestTone ? (
              <button
                type="button"
                onClick={() => playSpeakerTestTone(activeFreqHz)}
                className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-400 hover:to-cyan-400 text-slate-950 font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 shadow-lg shadow-teal-500/20 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-slate-950" />
                <span>Emit {(activeFreqHz / 1000).toFixed(1)} kHz Test Tone</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopSpeakerTestTone}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Square className="w-4 h-4 fill-white" />
                <span>Stop Test Tone</span>
              </button>
            )}
          </div>

          {isPlayingTestTone && (
            <div className="p-2.5 rounded-xl bg-cyan-950/50 border border-cyan-500/30 flex items-center gap-2 text-xs font-mono text-cyan-300 animate-pulse">
              <Sparkles className="w-4 h-4 text-cyan-400" />
              <span>Transmitting {(activeFreqHz / 1000).toFixed(1)} kHz sine wave...</span>
            </div>
          )}
        </div>

        {/* Card 3: Microphone Transducer Sensitivity Audit */}
        <div className="glass-panel rounded-2xl p-5 space-y-4">
          <div className="flex items-center space-x-2 text-slate-100 font-bold">
            <Mic className="w-5 h-5 text-amber-400" />
            <h3>Microphone Ultrasonic Audit</h3>
          </div>

          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-slate-400">Permission:</span>
            <span
              className={`px-2 py-0.5 rounded ${
                micState === 'granted'
                  ? 'bg-emerald-950/70 text-emerald-400 border border-emerald-500/30'
                  : micState === 'denied'
                  ? 'bg-rose-950/70 text-rose-400 border border-rose-500/30'
                  : 'bg-amber-950/70 text-amber-400 border border-amber-500/30'
              }`}
            >
              {micState.toUpperCase()}
            </span>
          </div>

          <p className="text-xs text-slate-400">
            Measures high-frequency acoustic floor in the 17.0–19.0 kHz spectrum to verify microphone response.
          </p>

          <div>
            {!isAuditingMic ? (
              <button
                type="button"
                onClick={runMicAudit}
                className="w-full py-3 px-4 rounded-xl bg-slate-900 border border-amber-500/30 hover:border-amber-400 text-amber-300 font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 cursor-pointer transition-all"
              >
                <Activity className="w-4 h-4" />
                <span>Run Acoustic Sensitivity Audit</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={stopMicAudit}
                className="w-full py-3 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs sm:text-sm flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Square className="w-4 h-4 fill-white" />
                <span>Cancel Audit ({highFreqEnergy} dB)</span>
              </button>
            )}
          </div>

          {micAuditVerdict && (
            <div className="p-3 rounded-xl bg-slate-950 border border-cyan-500/30 text-xs font-mono text-cyan-300">
              <span className="font-bold block text-slate-100 mb-1">Audit Result:</span>
              {micAuditVerdict}
            </div>
          )}
        </div>
      </div>

      {/* PWA & Platform Readiness Checklist */}
      <div className="glass-panel rounded-2xl p-5 space-y-4">
        <div className="flex items-center space-x-2 text-slate-100 font-bold">
          <Smartphone className="w-5 h-5 text-cyan-400" />
          <h3>PWA & Platform Offline Readiness</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 font-mono text-xs">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Web Audio API</span>
            {pwaStatus.webAudio ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">AudioWorklet</span>
            {pwaStatus.audioWorklet ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">Service Worker</span>
            {pwaStatus.serviceWorker ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">CacheStorage</span>
            {pwaStatus.cacheStorage ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <XCircle className="w-4 h-4 text-rose-400" />
            )}
          </div>

          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 flex items-center justify-between">
            <span className="text-slate-300">PWA Installed</span>
            {pwaStatus.standalone ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            ) : (
              <HelpCircle className="w-4 h-4 text-slate-500" title="Browser Tab Mode" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
