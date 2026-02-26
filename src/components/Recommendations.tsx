import React from 'react';
import { Recommendation } from '../services/geminiService';
import { MapPin, CheckCircle2, ArrowRight, Wallet, Calendar } from 'lucide-react';

interface RecommendationsProps {
  recommendations: Recommendation[];
  onSelect: (rec: Recommendation) => void;
  onBack: () => void;
}

export default function Recommendations({ recommendations, onSelect, onBack }: RecommendationsProps) {
  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-semibold text-slate-900 tracking-tight">Your Travel Options</h2>
          <p className="text-slate-500 mt-2">We've crafted these recommendations based on your preferences.</p>
        </div>
        <button
          onClick={onBack}
          className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors px-4 py-2 rounded-lg hover:bg-slate-100"
        >
          Change Preferences
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {recommendations.map((rec) => (
          <div
            key={rec.id}
            className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-xl transition-all duration-300 flex flex-col group cursor-pointer"
            onClick={() => onSelect(rec)}
          >
            <div className="h-48 bg-slate-100 relative overflow-hidden">
              <img
                src={`https://picsum.photos/seed/${encodeURIComponent(rec.title)}/800/600?blur=2`}
                alt={rec.title}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
              <div className="absolute bottom-4 left-4 right-4">
                <h3 className="text-xl font-bold text-white leading-tight">{rec.title}</h3>
              </div>
            </div>

            <div className="p-6 flex-1 flex flex-col">
              <p className="text-slate-600 text-sm mb-6 flex-1">{rec.description}</p>

              <div className="space-y-4 mb-6">
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <Wallet size={16} className="text-emerald-600" />
                  <span>Est. Cost: {rec.estimatedCost}</span>
                </div>
                <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                  <Calendar size={16} className="text-emerald-600" />
                  <span>Best Time: {rec.bestTimeToGo}</span>
                </div>
                
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Highlights</h4>
                  <ul className="space-y-2">
                    {rec.highlights.map((highlight, idx) => (
                      <li key={idx} className="flex items-start gap-2 text-sm text-slate-700">
                        <CheckCircle2 size={16} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <button
                className="w-full py-3 px-4 bg-slate-50 hover:bg-emerald-50 text-emerald-700 font-medium rounded-xl border border-slate-200 hover:border-emerald-200 transition-colors flex items-center justify-center gap-2 group-hover:bg-emerald-600 group-hover:text-white group-hover:border-emerald-600"
              >
                <span>View Itinerary</span>
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
