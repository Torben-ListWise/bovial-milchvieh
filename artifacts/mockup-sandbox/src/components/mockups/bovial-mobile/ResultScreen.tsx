import React from 'react';
import './_group.css';
import { 
  ArrowLeft, Share2, ThumbsUp, ThumbsDown, 
  BookMarked, FileText, Plus, Home, Sparkles, Settings 
} from 'lucide-react';

export function ResultScreen() {
  return (
    <div className="w-[390px] h-[844px] bg-[#0A0F1C] text-slate-200 font-sans flex flex-col relative overflow-hidden rounded-[40px] border-[8px] border-black shadow-2xl">
      {/* Status Bar Mock */}
      <div className="h-12 w-full flex justify-between items-center px-6 text-xs font-medium text-slate-400">
        <span>09:41</span>
        <div className="flex gap-1.5 items-center">
          <div className="w-4 h-3 border border-slate-400 rounded-[2px]" />
          <div className="w-3 h-3 rounded-full bg-slate-400" />
        </div>
      </div>

      {/* Top Bar */}
      <div className="flex items-center justify-between px-4 pb-4 border-b border-white/5">
        <button className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft size={24} />
        </button>
        <h1 className="text-lg font-medium text-white tracking-tight">Traechtigkeitsrate Q3</h1>
        <button className="p-2 -mr-2 text-slate-400 hover:text-white transition-colors">
          <Share2 size={24} />
        </button>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto pb-24 no-scrollbar">
        {/* AI Answer Card */}
        <div className="bg-[#12192B] p-5 border-b border-white/5">
          <div className="flex items-start gap-4">
            <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0 mt-1">
              <Sparkles size={16} />
            </div>
            <div className="flex-1 space-y-4">
              <p className="text-[15px] leading-relaxed text-slate-300">
                Die Traechtigkeitsrate im Q3 lag bei 62,4 % -- leicht unter dem Vorjahr (65,2 %). 
                Haeufigste Ursache: <span className="text-white font-medium">fruehe embryonale Verluste</span>. 
                Empfehlung: Hitzestress-Management pruefen.
              </p>
              <div className="flex gap-2">
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-400 transition-colors">
                  <ThumbsUp size={14} /> Hilfreich
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-400 transition-colors">
                  <ThumbsDown size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-8">
          {/* Chart Section */}
          <section>
            <h2 className="text-[15px] font-medium text-white mb-4">Traechtigkeitsrate nach Quartal</h2>
            <div className="h-56 w-full bg-[#12192B] rounded-2xl p-5 border border-white/5 relative flex items-end justify-between pb-8">
              {/* SVG Chart Background Elements */}
              <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none">
                <line x1="0" y1="20%" x2="100%" y2="20%" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                <line x1="0" y1="45%" x2="100%" y2="45%" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
                <line x1="0" y1="70%" x2="100%" y2="70%" stroke="rgba(255,255,255,0.05)" strokeDasharray="4 4" />
              </svg>
              
              {/* Chart Bars */}
              <div className="relative z-10 flex flex-col items-center gap-2 w-1/4">
                <div className="w-10 h-[120px] bg-slate-700/50 rounded-t-md transition-all hover:bg-slate-600/50" />
                <span className="text-xs text-slate-400 font-medium mt-1">Q1</span>
                <span className="text-[11px] text-slate-400 absolute -top-6">67%</span>
              </div>
              <div className="relative z-10 flex flex-col items-center gap-2 w-1/4">
                <div className="w-10 h-[110px] bg-slate-700/50 rounded-t-md transition-all hover:bg-slate-600/50" />
                <span className="text-xs text-slate-400 font-medium mt-1">Q2</span>
                <span className="text-[11px] text-slate-400 absolute -top-6">64%</span>
              </div>
              <div className="relative z-10 flex flex-col items-center gap-2 w-1/4">
                <div className="w-10 h-[100px] bg-indigo-500 rounded-t-md shadow-[0_0_20px_rgba(99,102,241,0.3)] transition-all" />
                <span className="text-xs text-indigo-400 font-bold mt-1">Q3</span>
                <span className="text-[11px] text-indigo-300 absolute -top-6 font-bold">62%</span>
              </div>
              <div className="relative z-10 flex flex-col items-center gap-2 w-1/4">
                <div className="w-10 h-[90px] border-2 border-dashed border-slate-700/50 rounded-t-md" />
                <span className="text-xs text-slate-600 font-medium mt-1">Q4</span>
                <span className="text-[11px] text-slate-600 absolute -top-6">--</span>
              </div>
            </div>
          </section>

          {/* Diary Section */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[15px] font-medium text-white flex items-center gap-2">
                <span>📔</span> Betriebstagebuch
              </h2>
              <span className="px-2 py-0.5 rounded-full bg-[#12192B] text-[10px] font-medium text-slate-300 border border-white/5">
                2 Eintraege
              </span>
            </div>

            <div className="space-y-3">
              {/* Card 1 */}
              <div className="bg-[#12192B] rounded-xl p-3.5 border border-white/5 flex gap-3.5">
                <div className="w-10 h-10 rounded-full bg-amber-500/10 text-amber-500 flex items-center justify-center shrink-0">
                  <BookMarked size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <h3 className="text-sm font-medium text-slate-200 truncate pr-2">Brunst beobachtet</h3>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap mt-0.5">Heute 09:32</span>
                  </div>
                  <p className="text-xs text-slate-400">Kuh #147</p>
                </div>
              </div>

              {/* Card 2 */}
              <div className="bg-[#12192B] rounded-xl p-3.5 border border-white/5 flex gap-3.5">
                <div className="w-10 h-10 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                  <FileText size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start mb-0.5">
                    <h3 className="text-sm font-medium text-slate-200 truncate pr-2">Tierarzt-Besuch</h3>
                    <span className="text-[10px] text-slate-500 whitespace-nowrap mt-0.5">Gestern</span>
                  </div>
                  <p className="text-xs text-slate-400">Routinekontrolle</p>
                </div>
              </div>

              {/* Add Button */}
              <button className="w-full py-3.5 rounded-xl border border-dashed border-white/10 text-sm font-medium text-slate-300 hover:text-white hover:border-white/30 hover:bg-white/5 transition-all flex items-center justify-center gap-2 mt-2">
                <Plus size={16} /> Eintrag hinzufuegen
              </button>
            </div>
          </section>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="absolute bottom-0 left-0 right-0 h-[88px] bg-[#0A0F1C]/95 backdrop-blur-md border-t border-white/5 px-6 flex justify-between items-center pb-6">
        <button className="flex flex-col items-center gap-1.5 text-slate-500">
          <Home size={22} strokeWidth={2} />
          <span className="text-[10px] font-medium">Betriebe</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-indigo-400">
          <Sparkles size={22} strokeWidth={2.5} />
          <span className="text-[10px] font-medium">Analyse</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-500">
          <FileText size={22} strokeWidth={2} />
          <span className="text-[10px] font-medium">Berichte</span>
        </button>
        <button className="flex flex-col items-center gap-1.5 text-slate-500">
          <Settings size={22} strokeWidth={2} />
          <span className="text-[10px] font-medium">Einstellungen</span>
        </button>
      </div>
    </div>
  );
}
