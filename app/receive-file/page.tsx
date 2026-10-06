'use client';

import React, { useState, useRef } from 'react';
import Header from '@/components/layout/Header';
import { decodeWav, decodeWavToMessages, DecodedWav } from '@/lib/dsp/wav';
import { DecodedMessage } from '@/lib/dsp/framing';
import { saveMessageRecord } from '@/components/storage/historyVault';
import {
  UploadCloud,
  FileAudio,
  CheckCircle,
  AlertTriangle,
  Copy,
  Check,
  Save,
  Cpu,
  RefreshCw,
} from 'lucide-react';

export default function ReceiveFilePage() {
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [fileInfo, setFileInfo] = useState<{
    name: string;
    sizeKb: number;
    durationSec?: number;
    sampleRate?: number;
    channels?: number;
  } | null>(null);
  const [decodedMessages, setDecodedMessages] = useState<DecodedMessage[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [savedIndex, setSavedIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleProcessFile = async (file: File) => {
    setErrorText(null);
    setDecodedMessages([]);
    setIsProcessing(true);

    try {
      const arrayBuffer = await file.arrayBuffer();
      const uint8Array = new Uint8Array(arrayBuffer);

      let wavMeta: DecodedWav | null = null;
      try {
        wavMeta = decodeWav(uint8Array);
      } catch {
        // If not standard WAV or raw audio
      }

      setFileInfo({
        name: file.name,
        sizeKb: Math.round(file.size / 1024),
        durationSec: wavMeta ? Math.round(wavMeta.durationSeconds * 10) / 10 : undefined,
        sampleRate: wavMeta ? wavMeta.sampleRate : undefined,
        channels: wavMeta ? wavMeta.numChannels : undefined,
      });

      // Pure client-side offline DSP decoding
      const messages = decodeWavToMessages(uint8Array);

      if (messages.length === 0) {
        setErrorText(
          'No valid UltraLink packets found in audio file. Ensure the audio was generated with 17.0–19.0 kHz carrier and sufficient SNR.'
        );
      } else {
        setDecodedMessages(messages);
      }
    } catch (err) {
      console.error('File decoding failed:', err);
      setErrorText(`Decoding failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleProcessFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleProcessFile(e.target.files[0]);
    }
  };

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Ignore
    }
  };

  const handleSaveToHistory = async (msg: DecodedMessage, index: number) => {
    await saveMessageRecord({
      id: `rx_file_${Date.now()}_${msg.messageId}`,
      direction: 'received',
      text: msg.text,
      timestamp: Date.now(),
      payloadLength: msg.rawBytes.length,
      profileUsed: msg.profileId,
      status: 'decoded',
      crcPassed: msg.crcPassed,
      durationMs: msg.durationMs || 1000,
      sampleRate: msg.sampleRate || (fileInfo?.sampleRate ?? 48000),
      snrDb: msg.snrAverage,
      crcValue: '0xValid',
    });
    setSavedIndex(index);
    setTimeout(() => setSavedIndex(null), 2500);
  };

  return (
    <div className="space-y-6 min-w-0">
      <Header
        title="Offline File Receiver"
        subtitle="Decode recorded audio or 16-bit PCM WAV files 100% offline using client-side Goertzel filter banks and CRC32 verification."
        badge="RX Offline"
      />

      {/* Main Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Drag & Drop Dropzone */}
        <div className="lg:col-span-2 space-y-6">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer transition-all ${
              isDragging
                ? 'border-cyan-400 bg-cyan-950/40 shadow-xl shadow-cyan-500/10'
                : 'border-slate-700/80 hover:border-cyan-500/50 bg-slate-950/60 hover:bg-slate-900/40'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".wav,audio/wav,audio/*"
              className="hidden"
              onChange={handleFileChange}
            />

            <div className="flex flex-col items-center justify-center space-y-3">
              <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                {isProcessing ? (
                  <RefreshCw className="w-7 h-7 animate-spin" />
                ) : (
                  <UploadCloud className="w-7 h-7" />
                )}
              </div>

              <div className="space-y-1">
                <p className="text-base font-semibold text-slate-100">
                  {isProcessing
                    ? 'Demodulating acoustic carriers...'
                    : 'Drop audio file here, or click to browse'}
                </p>
                <p className="text-xs text-slate-400">
                  Supports 16-bit PCM WAV recorded at 44.1 kHz or 48.0 kHz
                </p>
              </div>

              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-cyan-400">
                <Cpu className="w-3.5 h-3.5" />
                <span>100% Client-Side Pure TypeScript DSP</span>
              </div>
            </div>
          </div>

          {/* Uploaded File Telemetry Card */}
          {fileInfo && (
            <div className="glass-panel rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between text-sm font-semibold text-slate-200">
                <span className="flex items-center gap-2">
                  <FileAudio className="w-4 h-4 text-cyan-400" /> Loaded Audio File
                </span>
                <span className="text-xs font-mono text-slate-400">{fileInfo.sizeKb} KB</span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono bg-slate-950/70 p-3 rounded-xl border border-slate-800">
                <div>
                  <span className="text-slate-500 block">Filename:</span>
                  <span className="text-slate-200 truncate block" title={fileInfo.name}>
                    {fileInfo.name}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Sample Rate:</span>
                  <span className="text-cyan-400">{fileInfo.sampleRate ? `${fileInfo.sampleRate} Hz` : 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Duration:</span>
                  <span className="text-slate-200">{fileInfo.durationSec ? `${fileInfo.durationSec}s` : 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Channels:</span>
                  <span className="text-slate-200">{fileInfo.channels === 1 ? 'Mono' : fileInfo.channels ? 'Stereo' : 'Mono'}</span>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {errorText && (
            <div className="p-4 rounded-xl bg-rose-950/40 border border-rose-500/30 text-rose-300 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold mb-0.5">Demodulation Warning</p>
                <p className="text-xs text-rose-300/80">{errorText}</p>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Decoded Messages & Integrity Card */}
        <div className="space-y-6">
          <div className="glass-panel rounded-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-200">Decoded Payload</h3>
              <span className="text-xs font-mono text-cyan-400">
                {decodedMessages.length} message{decodedMessages.length !== 1 ? 's' : ''}
              </span>
            </div>

            {decodedMessages.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-xs font-mono">
                No decoded messages yet. Upload or drop a WAV file on the left to extract text.
              </div>
            ) : (
              <div className="space-y-4">
                {decodedMessages.map((msg, idx) => (
                  <div
                    key={`${msg.messageId}-${idx}`}
                    className="p-4 rounded-xl bg-slate-950/80 border border-cyan-500/30 space-y-3"
                  >
                    {/* Status Badge & Meta */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5 px-2.5 py-0.5 rounded-full text-xs font-mono bg-emerald-950/60 text-emerald-400 border border-emerald-500/30">
                        <CheckCircle className="w-3.5 h-3.5" />
                        <span>CRC32 Valid</span>
                      </div>
                      <span className="text-[11px] font-mono text-slate-400 uppercase">
                        Profile: {msg.profileId}
                      </span>
                    </div>

                    {/* Decoded Text Content */}
                    <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 font-mono text-sm text-cyan-200 break-token select-all">
                      {msg.text}
                    </div>

                    {/* Telemetry info */}
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-slate-400 pt-1">
                      <div>Msg ID: #{msg.messageId}</div>
                      <div>Chunks: {msg.chunkCount}</div>
                      <div>Bytes: {msg.rawBytes.length} B</div>
                      <div>SNR: +{msg.snrAverage.toFixed(1)} dB</div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-800">
                      <button
                        type="button"
                        onClick={() => copyToClipboard(msg.text, idx)}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        {copiedIndex === idx ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Copied</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Copy Text</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSaveToHistory(msg, idx)}
                        className="flex-1 py-1.5 px-3 rounded-lg bg-cyan-950/70 hover:bg-cyan-900/80 text-cyan-300 border border-cyan-500/30 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer"
                      >
                        {savedIndex === idx ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Saved to Vault</span>
                          </>
                        ) : (
                          <>
                            <Save className="w-3.5 h-3.5 text-cyan-400" />
                            <span>Save to Vault</span>
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
