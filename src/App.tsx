import React, {
  useState,
  useRef,
  useEffect,
  Component,
  ReactNode,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import TravelForm from "./components/TravelForm";
import Recommendations from "./components/Recommendations";
import Itinerary from "./components/Itinerary";
import { getRecommendations, getItinerary } from "./services/geminiService";
import type { TravelFormData, Recommendation } from "./services/geminiService";
import { Compass } from "lucide-react";

type AppState = "input" | "recommendations" | "itinerary";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 font-sans text-slate-900">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-red-100 max-w-md w-full text-center">
            <h2 className="text-2xl font-bold mb-2">
              Oops, something went wrong.
            </h2>
            <p className="text-slate-600 mb-6">
              We encountered an unexpected error displaying this page.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="px-6 py-3 bg-emerald-600 text-white font-medium rounded-xl hover:bg-emerald-700 transition-colors"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppContent() {
  const [appState, setAppState] = useState<AppState>("input");
  const [formData, setFormData] = useState<TravelFormData | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [selectedRecommendation, setSelectedRecommendation] =
    useState<Recommendation | null>(null);
  const [itinerary, setItinerary] = useState<string>("");
  const [itineraryCache, setItineraryCache] = useState<Record<string, string>>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formResetKey, setFormResetKey] = useState(0);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Cleanup any pending requests when the component unmounts
  useEffect(() => {
    return () => abortControllerRef.current?.abort();
  }, []);

  const handleFormSubmit = async (data: TravelFormData) => {
    // Cache check: If form data hasn't changed, just show the existing recommendations
    if (
      formData &&
      JSON.stringify(data) === JSON.stringify(formData) &&
      recommendations.length > 0
    ) {
      setAppState("recommendations");
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);
    try {
      const recs = await getRecommendations(data, abortController.signal);
      if (recs && recs.length > 0) {
        setFormData(data);
        setRecommendations(recs);
        setItineraryCache({}); // Clear itinerary cache for new recommendations
        setAppState("recommendations");
      } else {
        setError("Couldn't generate recommendations. Please try again.");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Intentional abort, do nothing
      }
      console.error(err);
      setError(
        getErrorMessage(
          err,
          "An error occurred while fetching recommendations.",
        ),
      );
    } finally {
      if (abortControllerRef.current === abortController) {
        setIsLoading(false);
      }
    }
  };

  const handleRecommendationSelect = async (rec: Recommendation) => {
    if (!formData) return;

    // Cache check: If we already generated this itinerary, use it
    if (itineraryCache[rec.id]) {
      setSelectedRecommendation(rec);
      setItinerary(itineraryCache[rec.id]);
      setAppState("itinerary");
      return;
    }

    abortControllerRef.current?.abort();
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);
    try {
      const plan = await getItinerary(formData, rec, abortController.signal);
      if (plan) {
        setSelectedRecommendation(rec);
        setItinerary(plan);
        setItineraryCache((prev) => ({ ...prev, [rec.id]: plan }));
        setAppState("itinerary");
      } else {
        setError("Couldn't generate the itinerary. Please try again.");
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return; // Intentional abort, do nothing
      }
      console.error(err);
      setError(
        getErrorMessage(err, "An error occurred while fetching the itinerary."),
      );
    } finally {
      if (abortControllerRef.current === abortController) {
        setIsLoading(false);
      }
    }
  };

  const handleBackToForm = () => {
    abortControllerRef.current?.abort();
    setError(null);
    setAppState("input");
  };

  const handleBackToRecommendations = () => {
    abortControllerRef.current?.abort();
    setError(null);
    setAppState("recommendations");
  };

  const handleRestart = () => {
    abortControllerRef.current?.abort();
    setAppState("input");
    setFormData(null);
    setRecommendations([]);
    setSelectedRecommendation(null);
    setItinerary("");
    setItineraryCache({});
    setError(null);
    setIsLoading(false);
    setFormResetKey((prev) => prev + 1);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-emerald-200 selection:text-emerald-900">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-600">
            <Compass size={28} strokeWidth={2.5} />
            <span className="text-xl font-bold tracking-tight text-slate-900">
              Wanderlust
            </span>
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
            <button
              onClick={() => setError(null)}
              className="text-red-500 hover:text-red-700 font-medium text-sm"
            >
              Dismiss
            </button>
          </div>
        )}

        {isLoading && (
          <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="w-12 h-12 border-4 border-emerald-100 border-t-emerald-600 rounded-full animate-spin mb-4" />
            <p className="text-lg font-medium text-slate-700 animate-pulse">
              {appState === "recommendations"
                ? "Crafting your perfect itinerary..."
                : "Finding your perfect destinations..."}
            </p>
          </div>
        )}

        <AnimatePresence mode="wait">
          {appState === "input" && (
            <motion.div
              key="input"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.3 }}
            >
              <TravelForm
                key={formResetKey}
                onSubmit={handleFormSubmit}
                isLoading={isLoading}
                initialData={formData}
              />
            </motion.div>
          )}

          {appState === "recommendations" && (
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

          {appState === "itinerary" && selectedRecommendation && (
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

export default function App() {
  return (
    <ErrorBoundary>
      <AppContent />
    </ErrorBoundary>
  );
}
