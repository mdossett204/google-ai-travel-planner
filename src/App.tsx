import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import TravelForm from './components/TravelForm';
import Recommendations from './components/Recommendations';
import Itinerary from './components/Itinerary';
import { getRecommendations, getItinerary, TravelFormData, Recommendation } from './services/geminiService';
import { Compass } from 'lucide-react';

type AppState = 'input' | 'recommendations' | 'itinerary';

export default function App() {
  const [appState, setAppState] = useState<AppState>('input');
  const [formData, setFormData] = useState<TravelFormData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedRecommendation, setSelectedRecommendation] = useState<Recommendation | null>(null);
  const [itinerary, setItinerary] = useState<string>('');
  const [itineraryCache, setItineraryCache] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFormSubmit = async (data: TravelFormData) => {
    // Cache check: If form data hasn't changed, just show the existing recommendations
    if (formData && JSON.stringify(data) === JSON.stringify(formData) && recommendations.length > 0) {
      setAppState('recommendations');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const recs = await getRecommendations(data);
      if (recs && recs.length > 0) {
        setFormData(data);
        setRecommendations(recs);
        setItineraryCache({}); // Clear itinerary cache for new recommendations
        setAppState('recommendations');
      } else {
        setError("Couldn't generate recommendations. Please try again.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred while fetching recommendations.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleRecommendationSelect = async (rec: Recommendation) => {
    if (!formData) return;

    // Cache check: If we already generated this itinerary, use it
    if (itineraryCache[rec.id]) {
      setSelectedRecommendation(rec);
      setItinerary(itineraryCache[rec.id]);
      setAppState('itinerary');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const plan = await getItinerary(formData, rec);
      if (plan) {
        setSelectedRecommendation(rec);
        setItinerary(plan);
        setItineraryCache(prev => ({ ...prev, [rec.id]: plan }));
        setAppState('itinerary');
      } else {
        setError("Couldn't generate the itinerary. Please try again.");
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "An error occurred while fetching the itinerary.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleBackToForm = () => {
    setAppState('input');
  };

  const handleBackToRecommendations = () => {
    setAppState('recommendations');
  };

  const handleRestart = () => {
    setAppState('input');
    setFormData(null);
    setRecommendations([]);
    setSelectedRecommendation(null);
    setItinerary('');
    setItineraryCache({});
    setError(null);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-200 selection:text-emerald-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-600 cursor-pointer" onClick={handleRestart}>
            <Compass size={28} strokeWidth={2.5} />
            <span className="text-xl font-bold tracking-tight text-slate-900">Wanderlust</span>
          </div>
          <div className="text-sm font-medium text-slate-500 hidden sm:block">
            AI-Powered Travel Planner
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {error && (
          <div className="mb-8 p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700 font-medium text-sm">Dismiss</button>
          </div>
        )}

        {isLoading && appState !== 'input' && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mb-4" />
            <p className="text-lg font-medium text-slate-700 animate-pulse">
              {appState === 'recommendations' ? 'Crafting your perfect itinerary...' : 'Generating recommendations...'}
            </p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {appState === 'input' && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <TravelForm onSubmit={handleFormSubmit} isLoading={isLoading} initialData={formData} />
            </motion.div>
          )}

          {appState === 'recommendations' && (
            <motion.div
              key="recommendations"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Recommendations
                recommendations={recommendations}
                onSelect={handleRecommendationSelect}
                onBack={handleBackToForm}
              />
            </motion.div>
          )}

          {appState === 'itinerary' && selectedRecommendation && (
            <motion.div
              key="itinerary"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <Itinerary
                recommendation={selectedRecommendation}
                itinerary={itinerary}
                onBack={handleBackToRecommendations}
                onRestart={handleRestart}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}
