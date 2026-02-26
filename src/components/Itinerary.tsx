import React, { useRef, useState } from 'react';
import Markdown from 'react-markdown';
import { Recommendation } from '../services/geminiService';
import { ArrowLeft, Download, RefreshCcw } from 'lucide-react';

interface ItineraryProps {
  recommendation: Recommendation;
  itinerary: string;
  onBack: () => void;
  onRestart: () => void;
}

export default function Itinerary({ recommendation, itinerary, onBack, onRestart }: ItineraryProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  const handleDownload = () => {
    setIsDownloading(true);
    try {
      const element = document.createElement("a");
      const file = new Blob([itinerary], { type: 'text/markdown' });
      element.href = URL.createObjectURL(file);
      element.download = `${recommendation.title.replace(/\s+/g, '_')}_Itinerary.md`;
      document.body.appendChild(element);
      element.click();
      document.body.removeChild(element);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <button
            onClick={onBack}
            className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors mb-4"
          >
            <ArrowLeft size={16} />
            <span>Back to Options</span>
          </button>
          <h2 className="text-3xl font-semibold text-slate-900 tracking-tight">{recommendation.title}</h2>
          <p className="text-slate-500 mt-2">Your detailed travel plan and tips.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button
            onClick={handleDownload}
            disabled={isDownloading}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors text-sm disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isDownloading ? (
              <div className="w-4 h-4 border-2 border-slate-400 border-t-slate-700 rounded-full animate-spin" />
            ) : (
              <Download size={16} />
            )}
            <span>{isDownloading ? 'Saving...' : 'Save Plan'}</span>
          </button>
          <button
            onClick={onRestart}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-medium rounded-xl transition-colors text-sm"
          >
            <RefreshCcw size={16} />
            <span>Start Over</span>
          </button>
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 md:p-12">
        <div ref={contentRef} className="prose prose-slate prose-emerald max-w-none">
          <Markdown>{itinerary}</Markdown>
        </div>
      </div>
    </div>
  );
}
