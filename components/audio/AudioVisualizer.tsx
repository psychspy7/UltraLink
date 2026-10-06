'use client';

import React, { useEffect, useRef } from 'react';

interface AudioVisualizerProps {
  isTransmitting: boolean;
  progressPercent?: number; // 0 to 100
  audioBuffer?: Float32Array | null;
  statusText?: string;
  className?: string;
}

export const AudioVisualizer: React.FC<AudioVisualizerProps> = ({
  isTransmitting,
  progressPercent = 0,
  audioBuffer,
  statusText = 'Ready',
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let phase = 0;

    const render = () => {
      const width = canvas.width;
      const height = canvas.height;

      ctx.clearRect(0, 0, width, height);

      // Background grid
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.08)';
      ctx.lineWidth = 1;

      const gridSize = 24;
      for (let x = 0; x < width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }
      for (let y = 0; y < height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      // Center baseline
      ctx.strokeStyle = 'rgba(6, 182, 212, 0.2)';
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      if (isTransmitting) {
        phase += 0.08;

        // Draw active modulated ultrasonic burst visualization
        ctx.lineWidth = 2.5;
        const gradient = ctx.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, 'rgba(6, 182, 212, 0.2)');
        gradient.addColorStop(0.5, 'rgba(34, 211, 238, 1)');
        gradient.addColorStop(1, 'rgba(20, 184, 166, 0.2)');
        ctx.strokeStyle = gradient;

        ctx.beginPath();
        const sliceWidth = width / 180;
        let x = 0;

        for (let i = 0; i < 180; i++) {
          const envelope = Math.sin((i / 180) * Math.PI); // Windowed pulse
          const freqMod = Math.sin(phase * 2 + i * 0.15) * 0.5 + 0.5;
          const yOffset =
            Math.sin(phase * 4 + i * (0.3 + freqMod * 0.2)) *
            envelope *
            (height * 0.38);
          const y = height / 2 + yOffset;

          if (i === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
          x += sliceWidth;
        }
        ctx.stroke();

        // Secondary glow harmonic
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.5)';
        ctx.beginPath();
        x = 0;
        for (let i = 0; i < 180; i++) {
          const envelope = Math.sin((i / 180) * Math.PI);
          const yOffset =
            Math.cos(phase * 3 + i * 0.25) * envelope * (height * 0.2);
          const y = height / 2 + yOffset;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
          x += sliceWidth;
        }
        ctx.stroke();
      } else if (audioBuffer && audioBuffer.length > 0) {
        // Draw static encoded audio buffer overview
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(34, 211, 238, 0.75)';
        ctx.beginPath();

        const step = Math.max(1, Math.floor(audioBuffer.length / width));
        for (let i = 0; i < width; i++) {
          const sampleIdx = i * step;
          const val = audioBuffer[sampleIdx] || 0;
          const y = height / 2 + val * (height * 0.42);

          if (i === 0) ctx.moveTo(i, y);
          else ctx.lineTo(i, y);
        }
        ctx.stroke();
      } else {
        // Idle gentle pulse
        phase += 0.02;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(6, 182, 212, 0.3)';
        ctx.beginPath();
        for (let i = 0; i < width; i += 2) {
          const y = height / 2 + Math.sin(phase + i * 0.02) * 4;
          if (i === 0) ctx.moveTo(i, y);
          else ctx.lineTo(i, y);
        }
        ctx.stroke();
      }

      animRef.current = requestAnimationFrame(render);
    };

    // Resize handling
    const resizeObserver = new ResizeObserver(() => {
      if (!canvas) return;
      canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
      canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);
    });
    resizeObserver.observe(canvas);

    render();

    return () => {
      if (animRef.current) cancelAnimationFrame(animRef.current);
      resizeObserver.disconnect();
    };
  }, [isTransmitting, audioBuffer]);

  return (
    <div className={`relative rounded-xl border border-cyan-500/20 bg-slate-950/70 overflow-hidden ${className}`}>
      {/* Canvas */}
      <canvas
        ref={canvasRef}
        className="w-full h-32 sm:h-40 block"
        aria-label="Acoustic Transmission Waveform Visualizer"
      />

      {/* Top telemetry banner */}
      <div className="absolute top-2.5 left-3 right-3 flex items-center justify-between text-[11px] font-mono pointer-events-none">
        <div className="flex items-center space-x-2">
          <span
            className={`w-2 h-2 rounded-full ${
              isTransmitting ? 'bg-cyan-400 animate-ping' : 'bg-slate-600'
            }`}
          />
          <span className="text-slate-300 font-semibold">{statusText}</span>
        </div>
        <span className="text-cyan-400/80">
          {isTransmitting ? `Progress: ${Math.round(progressPercent)}%` : 'Carrier: 17.0–19.0 kHz'}
        </span>
      </div>

      {/* Progress Bar at bottom if transmitting */}
      {isTransmitting && (
        <div className="absolute bottom-0 left-0 right-0 h-1 bg-slate-900">
          <div
            className="h-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-all duration-100 ease-out shadow-sm shadow-cyan-400"
            style={{ width: `${Math.min(100, Math.max(0, progressPercent))}%` }}
          />
        </div>
      )}
    </div>
  );
};

export default AudioVisualizer;
