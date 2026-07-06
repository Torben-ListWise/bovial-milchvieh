import React from 'react';
import './_group.css';
import { ArrowLeft, MoreHorizontal, Send, CheckCircle2, Loader2, X } from 'lucide-react';

export function ChatScreen() {
  return (
    <div 
      className="bg-slate-950 text-slate-100 font-sans relative"
      style={{
        width: '390px',
        height: '844px',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
        borderRadius: '40px',
        border: '8px solid #0f172a'
      }}
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-slate-800 bg-slate-900/80 backdrop-blur z-10">
        <div className="flex items-center gap-3">
          <button className="p-2 -ml-2 rounded-full hover:bg-slate-800 text-slate-400 transition-colors">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="font-semibold text-slate-100 text-lg leading-tight">Musterhof GbR</h1>
            <div className="flex items-center gap-1.5 text-xs text-indigo-400">
              <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 animate-pulse"></span>
              KI Assistent
            </div>
          </div>
        </div>
        <button className="p-2 -mr-2 rounded-full hover:bg-slate-800 text-slate-400 transition-colors">
          <MoreHorizontal size={20} />
        </button>
      </div>

      {/* Chat Thread */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6 custom-scrollbar bg-gradient-to-b from-slate-950 to-slate-900">
        {/* AI Message 1 */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 border border-indigo-500 shadow-lg shadow-indigo-500/20 mt-auto">
            <span className="text-white text-xs font-bold">KI</span>
          </div>
          <div className="bg-slate-800 rounded-2xl rounded-bl-sm px-4 py-3 text-sm text-slate-200 max-w-[80%] leading-relaxed shadow-sm">
            Hallo! Ich habe deine Herdendaten analysiert. Was möchtest du wissen?
          </div>
        </div>

        {/* User Message */}
        <div className="flex gap-3 justify-end">
          <div className="bg-indigo-600 rounded-2xl rounded-br-sm px-4 py-3 text-sm text-white max-w-[80%] leading-relaxed shadow-md shadow-indigo-900/30">
            Wie ist die Trächtigkeitsrate im letzten Quartal?
          </div>
        </div>

        {/* AI Thinking / Response */}
        <div className="flex gap-3">
          <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center shrink-0 border border-indigo-500 shadow-lg shadow-indigo-500/20 mt-auto">
            <span className="text-white text-xs font-bold">KI</span>
          </div>
          <div className="flex flex-col gap-2 max-w-[80%]">
            
            {/* Thinking Pills */}
            <div className="flex flex-col gap-1.5 mb-1">
              <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-900/50 w-fit px-3 py-1.5 rounded-full border border-slate-800/50">
                <CheckCircle2 size={12} className="text-slate-600" />
                <span>Lese Datenschema</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-300 bg-slate-800/80 w-fit px-3 py-1.5 rounded-full border border-slate-700/50 shadow-sm">
                <CheckCircle2 size={12} className="text-emerald-500" />
                <span>Berechne alle Kennzahlen</span>
              </div>
              <div className="flex items-center gap-2 text-xs text-indigo-300 bg-indigo-950/40 w-fit px-3 py-1.5 rounded-full border border-indigo-900/50 shadow-sm">
                <Loader2 size={12} className="text-indigo-400 animate-spin" />
                <span>Berechne Statistiken</span>
              </div>
            </div>

            {/* Partial Response */}
            <div className="bg-slate-800 rounded-2xl rounded-tl-sm rounded-bl-sm px-4 py-3 text-sm text-slate-200 leading-relaxed shadow-sm">
              Die Trächtigkeitsrate im Q3 lag bei <span className="font-semibold text-white">62,4 %</span> — leicht unter<span className="animate-pulse">...</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Area */}
      <div className="relative p-4 bg-slate-900 border-t border-slate-800 z-10 pb-8">
        
        {/* Reminder Chip */}
        <div className="absolute -top-12 left-4 right-4 flex justify-center">
          <div className="bg-amber-500/10 border border-amber-500/30 backdrop-blur-md text-amber-200 text-xs px-4 py-2 rounded-full shadow-lg shadow-amber-900/20 flex items-center gap-2 animate-in slide-in-from-bottom-2 fade-in duration-300">
            <span>📅</span>
            <span className="font-medium">Ereignis eintragen?</span>
            <button className="ml-1 p-0.5 hover:bg-amber-500/20 rounded-full transition-colors">
              <X size={12} className="text-amber-400/80" />
            </button>
          </div>
        </div>

        {/* Input Bar */}
        <div className="flex items-end gap-2 bg-slate-950 border border-slate-800 rounded-3xl p-1.5 focus-within:border-indigo-500/50 focus-within:ring-1 focus-within:ring-indigo-500/50 transition-all shadow-inner">
          <div className="flex-1 min-h-[44px] flex items-center px-4">
            <span className="text-slate-500 text-sm">Frage stellen...</span>
          </div>
          <button className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 flex items-center justify-center shrink-0 transition-colors shadow-md shadow-indigo-900/50">
            <Send size={16} className="text-white ml-0.5" />
          </button>
        </div>
      </div>
      
    </div>
  );
}
