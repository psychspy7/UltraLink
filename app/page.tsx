import Link from 'next/link';
import { Radio, FileDown, Ear, Activity, Clock, ShieldCheck, ArrowRight } from 'lucide-react';

export default function HomePage() {
  return (
    <div className="flex flex-col items-center justify-center py-6 sm:py-12 text-center min-w-0">
      {/* Ultrasonic Badge */}
      <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-cyan-950/70 border border-cyan-500/30 text-cyan-300 text-xs font-mono font-medium mb-6 backdrop-blur-md shadow-lg shadow-cyan-500/10">
        <ShieldCheck className="w-4 h-4 text-cyan-400" />
        <span>17.0 kHz – 19.0 kHz Acoustic Carrier</span>
      </div>

      {/* Hero Headline */}
      <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-slate-100 max-w-4xl mb-4 leading-tight">
        Acoustic Air-Gapped <br />
        <span className="bg-gradient-to-r from-cyan-400 via-teal-300 to-cyan-500 bg-clip-text text-transparent">
          Device Communication
        </span>
      </h1>

      {/* Subhead */}
      <p className="text-base sm:text-lg text-slate-400 max-w-2xl mb-8 leading-relaxed">
        Transmit text, Unicode, and telemetry using near-ultrasonic sound waves via standard Web Audio.
        100% offline, cross-platform, zero pairing required.
      </p>

      {/* Primary Action Buttons */}
      <div className="flex flex-wrap items-center justify-center gap-4 mb-14">
        <Link
          href="/transmit"
          className="flex items-center space-x-2 px-6 py-3.5 rounded-xl bg-gradient-to-r from-cyan-500 to-teal-500 hover:from-cyan-400 hover:to-teal-400 text-slate-950 font-bold text-sm sm:text-base shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Radio className="w-5 h-5" />
          <span>Start Transmitting</span>
          <ArrowRight className="w-4 h-4 ml-1" />
        </Link>
        <Link
          href="/live-listen"
          className="flex items-center space-x-2 px-6 py-3.5 rounded-xl bg-slate-900/80 hover:bg-slate-800 text-slate-200 border border-cyan-500/30 hover:border-cyan-400 font-semibold text-sm sm:text-base backdrop-blur-md transition-all hover:scale-[1.02] active:scale-[0.98]"
        >
          <Ear className="w-5 h-5 text-cyan-400" />
          <span>Live Acoustic Receiver</span>
        </Link>
      </div>

      {/* Feature Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 w-full text-left">
        <Link
          href="/transmit"
          className="p-5 rounded-2xl glass-panel hover:glass-panel-glow transition-all group border border-cyan-500/15"
        >
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 text-cyan-400 group-hover:scale-110 transition-transform">
            <Radio className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">Acoustic Transmitter</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Synthesize near-ultrasonic MFSK audio tones in real-time or export downloadable 16-bit PCM WAV files.
          </p>
        </Link>

        <Link
          href="/receive-file"
          className="p-5 rounded-2xl glass-panel hover:glass-panel-glow transition-all group border border-cyan-500/15"
        >
          <div className="w-10 h-10 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center mb-4 text-teal-400 group-hover:scale-110 transition-transform">
            <FileDown className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">Offline File Decoder</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Drop recorded audio or WAV files to demodulate packets locally with pure client-side Goertzel filter banks.
          </p>
        </Link>

        <Link
          href="/live-listen"
          className="p-5 rounded-2xl glass-panel hover:glass-panel-glow transition-all group border border-cyan-500/15"
        >
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-4 text-cyan-400 group-hover:scale-110 transition-transform">
            <Ear className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">AudioWorklet Listener</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Real-time microphone stream with 60 FPS waterfall spectrogram and automatic CRC-verified packet assembly.
          </p>
        </Link>

        <Link
          href="/diagnostics"
          className="p-5 rounded-2xl glass-panel hover:glass-panel-glow transition-all group border border-cyan-500/15"
        >
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mb-4 text-amber-400 group-hover:scale-110 transition-transform">
            <Activity className="w-5 h-5" />
          </div>
          <h3 className="text-base font-bold text-slate-100 mb-1">Hardware Diagnostics</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Test transducer response, verify 44.1/48 kHz sample rates, and run 17–19 kHz acoustic speaker tests.
          </p>
        </Link>
      </div>
    </div>
  );
}
