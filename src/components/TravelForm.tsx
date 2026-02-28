import React, { useState } from "react";
import { TravelFormData } from "../services/geminiService";
import { PlaneTakeoff } from "lucide-react";

interface TravelFormProps {
  onSubmit: (data: TravelFormData) => void;
  isLoading: boolean;
  initialData?: TravelFormData | null;
}

const defaultFormData: TravelFormData = {
  timeOfYear: "",
  duration: "",
  travelers: "",
  budget: "",
  primaryGoal: [],
  foodPreferences: "",
  activityPreferences: "",
  transportation: [],
  locations: "",
  mustSeeLocations: "",
};

export default function TravelForm({
  onSubmit,
  isLoading,
  initialData,
}: TravelFormProps) {
  const [formData, setFormData] = useState<TravelFormData>(
    initialData || defaultFormData,
  );

  const handleChange = (
    e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleArrayToggle = (
    field: "primaryGoal" | "transportation",
    value: string,
  ) => {
    setFormData((prev) => {
      const current = (prev[field] as string[]) || [];
      if (current.includes(value)) {
        return { ...prev, [field]: current.filter((v) => v !== value) };
      } else {
        return { ...prev, [field]: [...current, value] };
      }
    });
  };

  const goalOptions = [
    "Relaxation",
    "Adventure",
    "Cultural Exploration",
    "Nature & Wildlife",
    "Food & Culinary",
    "Party & Nightlife",
  ];
  const transportOptions = [
    "Public Transit",
    "Rental Car",
    "Walking/Biking",
    "Taxis/Rideshare",
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-3 bg-emerald-100 text-emerald-600 rounded-xl">
          <PlaneTakeoff size={24} />
        </div>
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">
            Design Your Trip
          </h2>
          <p className="text-slate-500 text-sm mt-1">
            Tell us your preferences and we'll craft the perfect journey.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label
              htmlFor="timeOfYear"
              className="block text-sm font-medium text-slate-700"
            >
              Time of Year{" "}
              <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <select
              id="timeOfYear"
              name="timeOfYear"
              value={formData.timeOfYear}
              onChange={handleChange}
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            >
              <option value="" disabled>
                Select...
              </option>
              <option value="Spring">Spring</option>
              <option value="Summer">Summer</option>
              <option value="Autumn">Autumn</option>
              <option value="Winter">Winter</option>
              <option value="Flexible">Flexible</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="duration"
              className="block text-sm font-medium text-slate-700"
            >
              Duration
            </label>
            <select
              id="duration"
              name="duration"
              value={formData.duration}
              onChange={handleChange}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            >
              <option value="" disabled>
                Select...
              </option>
              <option value="Weekend (2-3 days)">Weekend (2-3 days)</option>
              <option value="1 Week">1 Week</option>
              <option value="2 Weeks">2 Weeks</option>
              <option value="1 Month+">1 Month+</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="travelers"
              className="block text-sm font-medium text-slate-700"
            >
              Travelers
            </label>
            <select
              id="travelers"
              name="travelers"
              value={formData.travelers}
              onChange={handleChange}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            >
              <option value="" disabled>
                Select...
              </option>
              <option value="Solo">Solo</option>
              <option value="Couple">Couple</option>
              <option value="Family">Family</option>
              <option value="Group of Friends">Group of Friends</option>
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="budget"
              className="block text-sm font-medium text-slate-700"
            >
              Budget
            </label>
            <select
              id="budget"
              name="budget"
              value={formData.budget}
              onChange={handleChange}
              required
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            >
              <option value="" disabled>
                Select...
              </option>
              <option value="Budget-friendly">Budget-friendly</option>
              <option value="Moderate">Moderate</option>
              <option value="Luxury">Luxury</option>
            </select>
          </div>

          <div className="space-y-3 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Primary Goals{" "}
              <span className="text-slate-400 font-normal">
                (Select multiple)
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {goalOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleArrayToggle("primaryGoal", option)}
                  className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    formData.primaryGoal.includes(option)
                      ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                      : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Transportation{" "}
              <span className="text-slate-400 font-normal">
                (Select multiple)
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {transportOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleArrayToggle("transportation", option)}
                  className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    formData.transportation.includes(option)
                      ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                      : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-slate-100">
          <div className="space-y-2">
            <label
              htmlFor="locations"
              className="block text-sm font-medium text-slate-700"
            >
              Preferred Locations{" "}
              <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <p className="text-xs text-slate-500 mb-2">
              You can suggest multiple options (e.g., "Japan or South Korea")
              and we'll pick the best one for your budget and season.
            </p>
            <input
              type="text"
              id="locations"
              name="locations"
              value={formData.locations}
              onChange={handleChange}
              placeholder="e.g., Japan or South Korea, Europe..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="mustSeeLocations"
              className="block text-sm font-medium text-slate-700"
            >
              Must-See Locations{" "}
              <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              id="mustSeeLocations"
              name="mustSeeLocations"
              value={formData.mustSeeLocations}
              onChange={handleChange}
              placeholder="e.g., Greece and France, or Eiffel Tower..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="foodPreferences"
              className="block text-sm font-medium text-slate-700"
            >
              Food Preferences
            </label>
            <input
              type="text"
              id="foodPreferences"
              name="foodPreferences"
              value={formData.foodPreferences}
              onChange={handleChange}
              required
              placeholder="e.g., Vegetarian, Local street food, Fine dining..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="activityPreferences"
              className="block text-sm font-medium text-slate-700"
            >
              Activity Preferences
            </label>
            <input
              type="text"
              id="activityPreferences"
              name="activityPreferences"
              value={formData.activityPreferences}
              onChange={handleChange}
              required
              placeholder="e.g., Museums, Hiking, Shopping..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            />
          </div>
        </div>

        <div className="pt-6 flex gap-4">
          <button
            type="button"
            onClick={() => setFormData(defaultFormData)}
            disabled={isLoading}
            className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-xl transition-colors disabled:opacity-70"
          >
            Clear
          </button>
          <button
            type="submit"
            disabled={isLoading}
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-medium py-3 px-6 rounded-xl transition-colors flex items-center justify-center gap-2 disabled:opacity-70 disabled:cursor-not-allowed"
          >
            {isLoading ? (
              <>
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>Generating Recommendations...</span>
              </>
            ) : (
              <span>Get Recommendations</span>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
