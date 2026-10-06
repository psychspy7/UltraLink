'use client';

import React, { useState, useEffect } from 'react';
import Header from '@/components/layout/Header';
import {
  LocalMessageRecord,
  getMessageRecords,
  deleteMessageRecord,
  clearMessageRecords,
} from '@/components/storage/historyVault';
import { encodeTextToWav } from '@/lib/dsp/wav';
import { PROFILES, DEFAULT_PROFILE } from '@/lib/dsp/profiles';
import {
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Filter,
  Download,
  Trash2,
  Copy,
  Check,
  CheckCircle,
  Database,
  RefreshCw,
} from 'lucide-react';

export default function HistoryPage() {
  const [messages, setMessages] = useState<LocalMessageRecord[]>([]);
  const [filterDirection, setFilterDirection] = useState<'all' | 'sent' | 'received'>('all');
  const [filterProfile, setFilterProfile] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const loadRecords = async () => {
    setLoading(true);
    const records = await getMessageRecords();
    setMessages(records);
    setLoading(false);
  };

  useEffect(() => {
    loadRecords();
  }, []);

  const handleDelete = async (id: string) => {
    await deleteMessageRecord(id);
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  const handleClearAll = async () => {
    if (window.confirm('Are you sure you want to clear all offline message records?')) {
      await clearMessageRecords();
      setMessages([]);
    }
  };

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(messages, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute('href', dataStr);
    dl.setAttribute('download', `ultralink_history_${Date.now()}.json`);
    dl.click();
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

  const handleDownloadWav = (msg: LocalMessageRecord) => {
    try {
      const sampleRate = msg.sampleRate || 48000;
      const wavBytes = encodeTextToWav(msg.text, DEFAULT_PROFILE, sampleRate);
      const blob = new Blob([wavBytes], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ultralink_history_${msg.id}.wav`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('WAV export error:', err);
    }
  };

  // Filter messages
  const filteredMessages = messages.filter((msg) => {
    if (filterDirection !== 'all' && msg.direction !== filterDirection) return false;
    if (filterProfile !== 'all' && !msg.profileUsed.toLowerCase().includes(filterProfile.toLowerCase())) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return msg.text.toLowerCase().includes(q) || msg.id.toLowerCase().includes(q);
    }
    return true;
  });

  return (
    <div className="space-y-6 min-w-0">
      <Header
        title="Message History & Vault"
        subtitle="Air-gapped client vault stored 100% offline in IndexedDB. No message plaintext is ever sent to external cloud servers."
        badge="Private Vault"
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportJson}
              disabled={messages.length === 0}
              className="py-2 px-3.5 rounded-xl bg-slate-900 border border-cyan-500/30 hover:border-cyan-400 text-xs font-semibold text-slate-200 flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-cyan-400" />
              <span>Export JSON</span>
            </button>
            <button
              type="button"
              onClick={handleClearAll}
              disabled={messages.length === 0}
              className="py-2 px-3.5 rounded-xl bg-rose-950/40 border border-rose-500/30 hover:border-rose-400 text-xs font-semibold text-rose-300 flex items-center gap-1.5 transition-all disabled:opacity-50 cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          </div>
        }
      />

      {/* Filter and Search Bar */}
      <div className="glass-panel rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search message text or ID..."
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-400 font-mono"
            />
          </div>

          {/* Direction Tabs */}
          <div className="flex rounded-xl bg-slate-950/80 p-1 border border-slate-800 shrink-0">
            {(['all', 'sent', 'received'] as const).map((dir) => (
              <button
                key={dir}
                type="button"
                onClick={() => setFilterDirection(dir)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer ${
                  filterDirection === dir
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {dir}
              </button>
            ))}
          </div>

          {/* Profile Filter Dropdown */}
          <div className="relative shrink-0">
            <select
              value={filterProfile}
              onChange={(e) => setFilterProfile(e.target.value)}
              className="w-full sm:w-auto px-3.5 py-2.5 rounded-xl bg-slate-950/80 border border-slate-700/80 text-xs font-mono text-slate-200 focus:outline-none focus:border-cyan-400"
            >
              <option value="all">All Profiles</option>
              <option value="reliable">Reliable (4-FSK)</option>
              <option value="balanced">Balanced (8-FSK)</option>
              <option value="fast">Fast (16-FSK)</option>
              <option value="experimental">Experimental (Dual)</option>
            </select>
          </div>
        </div>

        {/* Status / Count bar */}
        <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-1 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-cyan-400" />
            <span>IndexedDB Local Vault</span>
          </div>
          <span>Showing {filteredMessages.length} of {messages.length} items</span>
        </div>
      </div>

      {/* Message List */}
      {loading ? (
        <div className="glass-panel rounded-2xl p-12 text-center text-slate-400 text-sm flex items-center justify-center gap-2">
          <RefreshCw className="w-4 h-4 animate-spin text-cyan-400" />
          <span>Loading local history records...</span>
        </div>
      ) : filteredMessages.length === 0 ? (
        <div className="glass-panel rounded-2xl p-16 text-center text-slate-500 text-sm font-mono space-y-2">
          <p>No messages match your criteria.</p>
          <p className="text-xs text-slate-600">
            Transmissions sent from /transmit or decoded from /receive-file will automatically appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredMessages.map((msg) => {
            const isSent = msg.direction === 'sent';
            return (
              <div
                key={msg.id}
                className="glass-panel rounded-2xl p-4 sm:p-5 space-y-3 hover:border-cyan-500/40 transition-all"
              >
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div
                      className={`p-1.5 rounded-lg ${
                        isSent
                          ? 'bg-cyan-500/20 text-cyan-400'
                          : 'bg-emerald-500/20 text-emerald-400'
                      }`}
                    >
                      {isSent ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4" />
                      )}
                    </div>
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
                        {isSent ? 'Transmitted (TX)' : 'Received (RX)'}
                      </span>
                      <span className="text-[11px] font-mono text-slate-500 ml-2">
                        {new Date(msg.timestamp).toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center space-x-2">
                    <span className="flex items-center gap-1 text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                      <CheckCircle className="w-3 h-3" /> CRC32 Valid
                    </span>
                    <span className="text-[11px] font-mono text-cyan-300/80 bg-slate-900 px-2 py-0.5 rounded-md border border-slate-800">
                      {msg.profileUsed}
                    </span>
                  </div>
                </div>

                {/* Message Payload Content */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800/80 font-mono text-sm text-cyan-100 break-token select-all">
                  {msg.text}
                </div>

                {/* Footer Toolbar */}
                <div className="flex items-center justify-between text-xs font-mono text-slate-400 pt-1">
                  <div className="flex items-center space-x-3 text-[11px]">
                    <span>Length: {msg.payloadLength} B</span>
                    <span>Rate: {msg.sampleRate} Hz</span>
                    {typeof msg.snrDb === 'number' && <span>SNR: +{msg.snrDb.toFixed(1)} dB</span>}
                  </div>

                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => handleCopy(msg.text, msg.id)}
                      className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                      title="Copy text"
                    >
                      {copiedId === msg.id ? (
                        <Check className="w-4 h-4 text-emerald-400" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDownloadWav(msg)}
                      className="p-1.5 hover:bg-slate-800 rounded-lg text-slate-400 hover:text-cyan-300 transition-colors cursor-pointer"
                      title="Export as WAV audio"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(msg.id)}
                      className="p-1.5 hover:bg-rose-950/60 rounded-lg text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                      title="Delete record"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
