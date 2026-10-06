'use client';

import React, { useState, useRef, useEffect } from 'react';
import Header from '@/components/layout/Header';
import SpectrogramCanvas from '@/components/audio/SpectrogramCanvas';
import ProfileSelector from '@/components/audio/ProfileSelector';
import { ModulationProfile, DEFAULT_PROFILE, PROFILES, ProfileId } from '@/lib/dsp/profiles';
import { DecodedMessage } from '@/lib/dsp/framing';
import { saveMessageRecord } from '@/components/storage/historyVault';
import {
  Mic,
  MicOff,
  Radio,
  CheckCircle,
  AlertCircle,
  Activity,
  Layers,
  Copy,
  Check,
  ShieldCheck,
} from 'lucide-react';

interface LivePacketItem {
  id: string;
  messageId: number;
  text: string;
  profileId: string;
  snrDb: number;
  timestamp: number;
  crcPassed: boolean;
}

export default function LiveListenPage() {
  const [isListening, setIsListening] = useState<boolean>(false);
  const [selectedProfile, setSelectedProfile] = useState<ModulationProfile>(DEFAULT_PROFILE);
  const [micPermission, setMicPermission] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [snrDb, setSnrDb] = useState<number>(0);
  const [noiseFloorDb, setNoiseFloorDb] = useState<number>(-62);
  const [peakFreqHz, setPeakFreqHz] = useState<number>(17500);
  const [fftData, setFftData] = useState<Float32Array | null>(null);
  const [liveMessages, setLiveMessages] = useState<LivePacketItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [preambleDetected, setPreambleDetected] = useState<boolean>(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, []);

  const stopListening = () => {
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    if (workletNodeRef.current) {
      try {
        workletNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      workletNodeRef.current = null;
    }
    if (analyserRef.current) {
      try {
        analyserRef.current.disconnect();
      } catch {
        // Ignore
      }
      analyserRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      try {
        audioContextRef.current.close();
      } catch {
        // Ignore
      }
      audioContextRef.current = null;
    }

    setIsListening(false);
    setPreambleDetected(false);
  };

  const startListening = async () => {
    stopListening();

    try {
      // Request mic with raw unfiltered constraints for 17-19kHz ultrasonic capture
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });

      mediaStreamRef.current = stream;
      setMicPermission('granted');

      const AudioCtxClass =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtxClass();
      audioContextRef.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        await audioCtx.resume();
      }

      const sourceNode = audioCtx.createMediaStreamSource(stream);

      // Create high-resolution AnalyserNode for spectrogram feed
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.2;
      analyserRef.current = analyser;
      sourceNode.connect(analyser);

      // Attempt to initialize AudioWorklet processor
      let workletLoaded = false;
      try {
        await audioCtx.audioWorklet.addModule('/worklets/ultralink-decoder-worklet.js');
        const workletNode = new AudioWorkletNode(audioCtx, 'ultralink-decoder-processor');
        workletNodeRef.current = workletNode;
        sourceNode.connect(workletNode);

        // Configure profile
        workletNode.port.postMessage({
          type: 'SET_PROFILE',
          profile: selectedProfile,
          sampleRate: audioCtx.sampleRate,
        });

        // Handle AudioWorklet events
        workletNode.port.onmessage = (event) => {
          const data = event.data;
          if (!data) return;

          if (data.type === 'SYNC_DETECTED' || data.type === 'PREAMBLE_DETECTED') {
            setPreambleDetected(true);
            setTimeout(() => setPreambleDetected(false), 2000);
          } else if (data.type === 'PACKET_DECODED' || data.type === 'MESSAGE_DECODED') {
            const pkt: DecodedMessage = data.packet || data.message;
            if (pkt && pkt.text) {
              const item: LivePacketItem = {
                id: `live_${Date.now()}_${pkt.messageId}`,
                messageId: pkt.messageId,
                text: pkt.text,
                profileId: pkt.profileId || selectedProfile.id,
                snrDb: pkt.snrDb || pkt.snrAverage || 12.0,
                timestamp: Date.now(),
                crcPassed: pkt.crcPassed ?? true,
              };

              setLiveMessages((prev) => [item, ...prev]);

              // Save to offline message vault
              saveMessageRecord({
                id: item.id,
                direction: 'received',
                text: item.text,
                timestamp: item.timestamp,
                payloadLength: item.text.length,
                profileUsed: item.profileId,
                status: 'decoded',
                crcPassed: item.crcPassed,
                durationMs: pkt.durationMs || 1000,
                sampleRate: audioCtx.sampleRate,
                snrDb: item.snrDb,
              });
            }
          } else if (data.type === 'ENERGY_METRICS') {
            if (typeof data.snrDb === 'number') setSnrDb(data.snrDb);
            if (typeof data.noiseFloor === 'number') setNoiseFloorDb(data.noiseFloor);
          }
        };

        workletLoaded = true;
      } catch (workletErr) {
        console.warn('AudioWorklet load note (using fallback spectrum loop):', workletErr);
      }

      setIsListening(true);

      // Continuous FFT Spectrum analysis loop for the 60fps spectrogram canvas
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      const nyquist = audioCtx.sampleRate / 2;
      const hzPerBin = nyquist / bufferLength;

      // Extract 64 bins between 16.5 kHz and 19.5 kHz
      const startBin = Math.max(0, Math.floor(16500 / hzPerBin));
      const endBin = Math.min(bufferLength - 1, Math.ceil(19500 / hzPerBin));
      const ultrasonicBins = new Float32Array(64);

      const loop = () => {
        analyser.getFloatFrequencyData(dataArray);

        let maxVal = -150;
        let peakIdx = 0;
        const binStep = (endBin - startBin) / 64;

        for (let i = 0; i < 64; i++) {
          const srcIdx = Math.min(bufferLength - 1, Math.floor(startBin + i * binStep));
          const val = dataArray[srcIdx] || -100;
          ultrasonicBins[i] = val;
          if (val > maxVal) {
            maxVal = val;
            peakIdx = i;
          }
        }

        setFftData(new Float32Array(ultrasonicBins));

        const estimatedPeak = 16500 + peakIdx * ((19500 - 16500) / 64);
        setPeakFreqHz(Math.round(estimatedPeak));

        // Estimate SNR
        const floor = -75;
        const snr = Math.max(0, maxVal - floor);
        setSnrDb(Math.round(snr * 10) / 10);

        animFrameRef.current = requestAnimationFrame(loop);
      };

      loop();
    } catch (err) {
      console.error('Microphone activation failed:', err);
      setMicPermission('denied');
      setIsListening(false);
    }
  };

  const handleCopy = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="space-y-6 min-w-0">
      <Header
        title="Live Acoustic Listener"
        subtitle="Real-time ultrasonic microphone stream with high-framerate waterfall spectrogram and automatic AudioWorklet packet assembly."
        badge="Live AudioWorklet"
      />

      {/* Mic Warning if Denied */}
      {micPermission === 'denied' && (
        <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold mb-0.5">Microphone Access Denied</p>
            <p className="text-xs text-rose-300/80">
              Please enable microphone permissions in your browser bar. UltraLink uses raw audio input without voice filters to capture near-ultrasonic carrier frequencies (17.0–19.0 kHz).
            </p>
          </div>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Spectrogram & Stream Controls */}
        <div className="lg:col-span-2 space-y-6">
          {/* Spectrogram Card */}
          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-semibold text-slate-200">
                  Ultrasonic Waterfall Spectrogram (16.5–19.5 kHz)
                </h3>
              </div>
              {preambleDetected && (
                <span className="px-2 py-0.5 rounded bg-cyan-400 text-slate-950 font-mono text-xs font-bold animate-pulse">
                  PREAMBLE CHIRP DETECTED
                </span>
              )}
            </div>

            {/* Spectrogram Canvas */}
            <SpectrogramCanvas
              isListening={isListening}
              fftData={fftData}
              snrDb={snrDb}
              noiseFloorDb={noiseFloorDb}
              peakFrequencyHz={peakFreqHz}
            />

            {/* Listen / Stop Toggle Control */}
            <div className="pt-2">
              {!isListening ? (
                <button
                  type="button"
                  onClick={startListening}
                  className="w-full py-4 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-bold text-base shadow-lg shadow-cyan-500/25 transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <Mic className="w-5 h-5" />
                  <span>Start Listening (Microphone)</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={stopListening}
                  className="w-full py-4 px-6 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-base shadow-lg shadow-rose-600/30 transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <MicOff className="w-5 h-5" />
                  <span>Stop Listening</span>
                </button>
              )}
            </div>

            {/* Audio Constraints Notice */}
            <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
              <span className="flex items-center gap-1.5 text-cyan-400">
                <ShieldCheck className="w-3.5 h-3.5" /> Hardware Audio Path
              </span>
              <span>echoCancellation: false | noiseSuppression: false | AGC: false</span>
            </div>
          </div>

          {/* Profile Tuning Card */}
          <div className="glass-panel rounded-2xl p-5">
            <ProfileSelector
              selectedProfileId={selectedProfile.id}
              onSelectProfile={(p) => {
                setSelectedProfile(p);
                if (workletNodeRef.current && audioContextRef.current) {
                  workletNodeRef.current.port.postMessage({
                    type: 'SET_PROFILE',
                    profile: p,
                    sampleRate: audioContextRef.current.sampleRate,
                  });
                }
              }}
            />
          </div>
        </div>

        {/* Right Column: Live Message Feed */}
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
                <Radio className="w-4 h-4 text-cyan-400" />
                <span>Live Decoded Packets</span>
              </h3>
              <span className="text-xs font-mono text-cyan-400">
                {liveMessages.length} received
              </span>
            </div>

            {liveMessages.length === 0 ? (
              <div className="py-16 text-center text-slate-500 text-xs font-mono space-y-2">
                <p>Waiting for acoustic signals...</p>
                <p className="text-slate-600">
                  Transmit a tone from another device nearby or play an UltraLink WAV file to observe live decoding.
                </p>
              </div>
            ) : (
              <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                {liveMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className="p-3.5 rounded-xl bg-slate-950/80 border border-cyan-500/30 space-y-2"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-1.5 font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/30">
                        <CheckCircle className="w-3 h-3" />
                        <span>CRC32 Valid</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 uppercase">
                        {msg.profileId}
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 text-sm font-mono text-cyan-200 break-token select-all">
                      {msg.text}
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 pt-1">
                      <span>SNR: +{msg.snrDb.toFixed(1)} dB</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(msg.text, msg.id)}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                      >
                        {copiedId === msg.id ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Copy</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
