'use client';

import React, { useEffect, useRef } from 'react';

interface SpectrogramCanvasProps {
  isListening: boolean;
  fftData?: Float32Array | number[] | null;
  snrDb?: number;
  noiseFloorDb?: number;
  peakFrequencyHz?: number;
  className?: string;
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({
  isListening,
  fftData,
  snrDb = 0,
  noiseFloorDb = -60,
  peakFrequencyHz = 17500,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);
  const latestDataRef = useRef<Float32Array | number[] | null>(null);

  useEffect(() => {
    latestDataRef.current = fftData || null;
  }, [fftData]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      if (width === 0 || height === 0) {
        animRef.current = requestAnimationFrame(render);
        return;
      }

      // Scroll existing canvas contents down by 2px (Waterfall effect)
      ctx.drawImage(canvas, 0, 0, width, height - 2, 0, 2, width, height - 2);

      // Render new top scanline
      const bins = latestDataRef.current;
      const binCount = bins ? bins.length : 64;
      const binWidth = width / binCount;

      phase += 0.05;

      for (let i = 0; i < binCount; i++) {
        let intensity = 0;

        if (isListening && bins && bins.length > 0) {
          // Normalize energy [0..1]
          const rawVal = bins[i] || 0;
          intensity = Math.min(1.0, Math.max(0.0, (rawVal + 70) / 70));
        } else if (isListening) {
          // Ambient idle baseline noise
          intensity = 0.08 + Math.random() * 0.06;
        } else {
          // Off
          intensity = 0.02;
        }

        // Color map: Dark Navy -> Teal -> Bright Cyan -> Neon Yellow/White for hot peaks
        let r = 7;
        let g = 11;
        let b = 20;

        if (intensity > 0.05) {
          if (intensity < 0.4) {
            // Navy to Teal
            const t = (intensity - 0.05) / 0.35;
            r = Math.floor(7 + t * 5);
            g = Math.floor(11 + t * 170);
            b = Math.floor(20 + t * 190);
          } else if (intensity < 0.75) {
            // Teal to Bright Cyan
            const t = (intensity - 0.4) / 0.35;
            r = Math.floor(12 + t * 22);
            g = Math.floor(181 + t * 30);
            b = Math.floor(210 + t * 28);
          } else {
            // Bright Cyan to Neon White Peak
            const t = (intensity - 0.75) / 0.25;
            r = Math.floor(34 + t * 220);
            g = Math.floor(211 + t * 44);
            b = Math.floor(238 + t * 17);
          }
        }

        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(i * binWidth, 0, binWidth + 1, 2);
      }

      // Draw frequency markers along the bottom overlay
      animRef.current = requestAnimationFrame(render);
    };

    const resizeObserver = new ResizeObserver(() => {
      if (!canvas) return;
      const w = canvas.clientWidth * (window.devicePixelRatio || 1);
      const h = canvas.clientHeight * (window.devicePixelRatio || 1);
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
        // Fill initial void background
        ctx.fillStyle = '#070B14';
        ctx.fillRect(0, 0, w, h);
      }
    });
    resizeObserver.observe(canvas);

    render();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [isListening]);

  return (
    <div className={`relative rounded-xl border border-cyan-500/20 bg-slate-950/80 overflow-hidden ${className}`}>
      {/* Waterfall Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-48 sm:h-64 block"
        aria-label="Ultrasonic 60fps Waterfall Spectrogram"
      />

      {/* Frequency Graticule Guide (16.5 kHz to 19.5 kHz) */}
      <div className="absolute bottom-1 left-2 right-2 flex justify-between text-[10px] font-mono text-cyan-400/80 pointer-events-none border-t border-cyan-500/20 pt-1">
        <span>16.5 kHz</span>
        <span>17.0 kHz</span>
        <span className="text-cyan-300 font-bold">17.5 kHz</span>
        <span>18.0 kHz</span>
        <span className="text-cyan-300 font-bold">18.5 kHz</span>
        <span>19.0 kHz</span>
        <span>19.5 kHz</span>
      </div>

      {/* Top telemetry HUD */}
      <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between text-[11px] font-mono pointer-events-none">
        <div className="flex items-center space-x-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isListening ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'
            }`}
          />
          <span className="text-slate-200 font-medium">
            {isListening ? '60 FPS Waterfall Spectrogram' : 'Acoustic Ear Standby'}
          </span>
        </div>
        <div className="flex items-center space-x-3 text-cyan-300">
          <span>SNR: {snrDb > 0 ? `+${snrDb.toFixed(1)}` : snrDb.toFixed(1)} dB</span>
          <span className="hidden sm:inline text-slate-400">
            Floor: {noiseFloorDb.toFixed(0)} dB
          </span>
          {isListening && peakFrequencyHz > 0 && (
            <span className="text-teal-300 font-semibold">
              Peak: {(peakFrequencyHz / 1000).toFixed(2)} kHz
            </span>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpectrogramCanvas;
