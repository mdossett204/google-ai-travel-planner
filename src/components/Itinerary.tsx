import Markdown from "react-markdown";
import type { Recommendation } from "../services/geminiService";
import { ArrowLeft, Download, RefreshCcw } from "lucide-react";

interface ItineraryProps {
  recommendation: Recommendation;
  itinerary: string;
  onBack: () => void;
  onRestart: () => void;
}

export default function Itinerary({
  recommendation,
  itinerary,
  onBack,
  onRestart,
}: ItineraryProps) {
  const handleDownload = () => {
    const fileName =
      recommendation.title
        .trim()
        .replace(/[^\w.-]+/g, "_")
        .replace(/^_+|_+$/g, "") || "Travel";

    const element = document.createElement("a");
    const file = new Blob([itinerary], { type: "text/markdown" });
    const objectUrl = URL.createObjectURL(file);
    element.href = objectUrl;
    element.download = `${fileName}_Itinerary.md`;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    URL.revokeObjectURL(objectUrl);
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
          <h2 className="text-3xl font-semibold text-slate-900 tracking-tight">
            {recommendation.title}
          </h2>
          <p className="text-slate-500 mt-2">
            Your detailed travel plan and tips.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors text-sm"
          >
            <Download size={16} />
            <span>Save Plan</span>
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
        <div className="prose prose-slate prose-emerald max-w-none">
          <Markdown>{itinerary}</Markdown>
        </div>
      </div>
    </div>
  );
}
