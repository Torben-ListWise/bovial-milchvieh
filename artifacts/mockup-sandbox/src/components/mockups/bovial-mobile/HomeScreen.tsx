import React from 'react';
import { Home, MessageSquare, FileText, Settings, Plus, Milk, ChevronRight, User } from 'lucide-react';
import './_group.css';

export function HomeScreen() {
  return (
    <div 
      className="flex flex-col bg-[#1a1b2e] text-slate-200" 
      style={{ width: '390px', height: '844px', overflow: 'hidden', position: 'relative' }}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-6 pt-12 pb-4">
        <h1 className="text-2xl font-semibold tracking-wide text-white">Bovial</h1>
        <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center shadow-inner">
          <User size={20} className="text-slate-300" />
        </div>
      </header>

      {/* Greeting */}
      <div className="px-6 py-2">
        <h2 className="text-3xl font-bold text-white mb-1">Guten Morgen, Klaus</h2>
        <p className="text-slate-400 text-sm">Deine Betriebe im Überblick</p>
      </div>

      {/* Cards List */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4 pb-28">
        
        {/* Card 1 */}
        <div className="bg-[#24263e] rounded-2xl p-5 border border-slate-700/50 shadow-lg relative cursor-pointer active:scale-[0.98] transition-transform">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Musterhof GbR</h3>
              <div className="flex items-center text-sm text-slate-400 mt-1">
                <Milk size={14} className="mr-1.5 text-indigo-400" />
                <span>Milchvieh 🐄</span>
              </div>
            </div>
            <div className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-full font-medium border border-emerald-500/20">
              Bereit
            </div>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="flex space-x-6">
              <div className="flex flex-col">
                <span className="text-slate-500 text-[11px] uppercase tracking-wider mb-0.5">Dateien</span>
                <span className="font-medium text-slate-200">3</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 text-[11px] uppercase tracking-wider mb-0.5">Letzte Analyse</span>
                <span className="font-medium text-slate-200">Heute</span>
              </div>
            </div>
            <ChevronRight size={20} className="text-slate-500" />
          </div>
        </div>

        {/* Card 2 */}
        <div className="bg-[#24263e] rounded-2xl p-5 border border-slate-700/50 shadow-lg relative cursor-pointer active:scale-[0.98] transition-transform">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Bergbauernhof Huber</h3>
              <div className="flex items-center text-sm text-slate-400 mt-1">
                <Milk size={14} className="mr-1.5 text-indigo-400" />
                <span>Milchvieh 🐄</span>
              </div>
            </div>
            <div className="bg-emerald-500/10 text-emerald-400 text-xs px-2.5 py-1 rounded-full font-medium border border-emerald-500/20">
              Bereit
            </div>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="flex space-x-6">
              <div className="flex flex-col">
                <span className="text-slate-500 text-[11px] uppercase tracking-wider mb-0.5">Dateien</span>
                <span className="font-medium text-slate-200">5</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 text-[11px] uppercase tracking-wider mb-0.5">Letzte Analyse</span>
                <span className="font-medium text-slate-200">Gestern</span>
              </div>
            </div>
            <ChevronRight size={20} className="text-slate-500" />
          </div>
        </div>

        {/* Card 3 */}
        <div className="bg-[#24263e] rounded-2xl p-5 border border-amber-500/30 shadow-[0_0_15px_rgba(245,158,11,0.05)] relative cursor-pointer active:scale-[0.98] transition-transform">
          <div className="flex justify-between items-start mb-3">
            <div>
              <h3 className="text-lg font-semibold text-white">Milchhof Böschen</h3>
              <div className="flex items-center text-sm text-slate-400 mt-1">
                <Milk size={14} className="mr-1.5 text-indigo-400" />
                <span>Milchvieh 🐄</span>
              </div>
            </div>
            <div className="bg-amber-500/10 text-amber-400 text-xs px-2.5 py-1 rounded-full font-medium border border-amber-500/20 flex items-center shadow-[0_0_10px_rgba(245,158,11,0.2)]">
              <span className="w-1.5 h-1.5 bg-amber-400 rounded-full mr-1.5 animate-pulse"></span>
              Neue Daten
            </div>
          </div>
          <div className="flex items-center justify-between mt-4 text-sm">
            <div className="flex space-x-6">
              <div className="flex flex-col">
                <span className="text-slate-500 text-[11px] uppercase tracking-wider mb-0.5">Dateien</span>
                <span className="font-medium text-slate-200">2 neu</span>
              </div>
              <div className="flex flex-col">
                <span className="text-slate-500 text-[11px] uppercase tracking-wider mb-0.5">Letzte Analyse</span>
                <span className="font-medium text-slate-200">Vor 3 Tagen</span>
              </div>
            </div>
            <ChevronRight size={20} className="text-slate-500" />
          </div>
        </div>

      </div>

      {/* FAB */}
      <button className="absolute bottom-28 right-6 w-14 h-14 bg-indigo-500 hover:bg-indigo-600 active:bg-indigo-700 text-white rounded-full shadow-[0_4px_14px_rgba(99,102,241,0.4)] flex items-center justify-center transition-colors">
        <Plus size={28} />
      </button>

      {/* Bottom Nav */}
      <nav className="absolute bottom-0 w-full bg-[#1e2036]/95 backdrop-blur-md border-t border-slate-700/50 pb-8 pt-3 px-6 flex justify-between items-center h-[90px]">
        <div className="flex flex-col items-center justify-center text-indigo-400 cursor-pointer">
          <Home size={24} className="mb-1" />
          <span className="text-[10px] font-medium">Betriebe</span>
        </div>
        <div className="flex flex-col items-center justify-center text-slate-500 hover:text-slate-400 cursor-pointer transition-colors">
          <MessageSquare size={24} className="mb-1" />
          <span className="text-[10px] font-medium">Analyse</span>
        </div>
        <div className="flex flex-col items-center justify-center text-slate-500 hover:text-slate-400 cursor-pointer transition-colors">
          <FileText size={24} className="mb-1" />
          <span className="text-[10px] font-medium">Berichte</span>
        </div>
        <div className="flex flex-col items-center justify-center text-slate-500 hover:text-slate-400 cursor-pointer transition-colors">
          <Settings size={24} className="mb-1" />
          <span className="text-[10px] font-medium">Einstellungen</span>
        </div>
      </nav>
      
    </div>
  );
}
