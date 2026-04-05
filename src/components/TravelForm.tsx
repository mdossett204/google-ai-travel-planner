import React, { useState } from "react";
import { TravelFormData } from "../services/geminiService";
import { PlaneTakeoff } from "lucide-react";

interface TravelFormProps {
  onSubmit: (data: TravelFormData) => void;
  isLoading: boolean;
  initialData?: TravelFormData | null;
}

const defaultFormData: TravelFormData = {
  timeOfYear: [],
  durationValue: "",
  durationUnit: "days",
  travelers: "",
  budget: {
    lodging: "",
    localTransportation: "",
    food: "",
    misc: "",
  },
  primaryGoal: [],
  foodPreferences: {
    dietaryRestrictions: [],
    cuisineInterests: [],
    diningStyle: [],
    foodPriority: "",
  },
  lodgingPreferences: {
    lodgingTypes: [],
  },
  localTransportation: [],
  preferredLocation: {
    country: "",
    stateOrProvince: "",
    city: "",
  },
  attractionInterests: "",
};

function buildInitialFormData(
  initialData?: TravelFormData | null,
): TravelFormData {
  if (!initialData) {
    return defaultFormData;
  }

  return {
    ...defaultFormData,
    ...initialData,
    budget: {
      ...defaultFormData.budget,
      ...initialData.budget,
    },
    foodPreferences: {
      ...defaultFormData.foodPreferences,
      ...initialData.foodPreferences,
    },
    lodgingPreferences: {
      ...defaultFormData.lodgingPreferences,
      ...initialData.lodgingPreferences,
    },
    preferredLocation: {
      ...defaultFormData.preferredLocation,
      ...initialData.preferredLocation,
    },
  };
}

export default function TravelForm({
  onSubmit,
  isLoading,
  initialData,
}: TravelFormProps) {
  const [formData, setFormData] = useState<TravelFormData>(
    buildInitialFormData(initialData),
  );
  const [showFoodPriorityError, setShowFoodPriorityError] = useState(false);

  const handleChange = (
    e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleArrayToggle = (
    field: "primaryGoal" | "localTransportation" | "timeOfYear",
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

  const handlePreferredLocationChange = (
    field: "country" | "stateOrProvince" | "city",
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      preferredLocation: {
        ...prev.preferredLocation,
        [field]: value,
      },
    }));
  };

  const handleFoodArrayToggle = (
    field: "dietaryRestrictions" | "cuisineInterests" | "diningStyle",
    value: string,
  ) => {
    const exclusiveOptionByField = {
      dietaryRestrictions: "No Restrictions",
      cuisineInterests: "No Preference",
      diningStyle: "",
    } as const;

    setFormData((prev) => {
      const current = prev.foodPreferences[field] || [];
      const exclusiveOption = exclusiveOptionByField[field];

      if (current.includes(value)) {
        return {
          ...prev,
          foodPreferences: {
            ...prev.foodPreferences,
            [field]: current.filter((item) => item !== value),
          },
        };
      }

      if (exclusiveOption && value === exclusiveOption) {
        return {
          ...prev,
          foodPreferences: {
            ...prev.foodPreferences,
            [field]: [value],
          },
        };
      }

      return {
        ...prev,
        foodPreferences: {
          ...prev.foodPreferences,
          [field]: current
            .filter((item) => item !== exclusiveOption)
            .concat(value),
        },
      };
    });
  };

  const handleFoodPriorityChange = (
    value: "Not Important" | "Nice to Have" | "Major Trip Focus" | "",
  ) => {
    setFormData((prev) => ({
      ...prev,
      foodPreferences: {
        ...prev.foodPreferences,
        foodPriority:
          prev.foodPreferences.foodPriority === value && value !== ""
            ? ""
            : value,
      },
    }));
    setShowFoodPriorityError(false);
  };

  const handleLodgingTypeToggle = (value: string) => {
    setFormData((prev) => {
      const current = prev.lodgingPreferences.lodgingTypes || [];
      return {
        ...prev,
        lodgingPreferences: {
          ...prev.lodgingPreferences,
          lodgingTypes: current.includes(value)
            ? current.filter((item) => item !== value)
            : [...current, value],
        },
      };
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
    "Own Car",
  ];
  const monthOptions = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const dietaryRestrictionOptions = [
    "Vegan",
    "Vegetarian",
    "Gluten-Free",
    "Dairy-Free",
    "Nut-Free",
    "Halal",
    "Kosher",
    "Paleo",
    "Carnivore",
    "No Restrictions",
  ];
  const cuisineInterestOptions = [
    "Seafood",
    "Regional Specialties",
    "Ethnic",
    "Street Food",
    "Cafe/Bakery",
    "No Preference",
  ];
  const diningStyleOptions = [
    "Casual",
    "Quick Meals",
    "Family-Friendly",
    "Scenic Dining",
    "Fine Dining",
  ];
  const foodPriorityOptions: Array<
    "Not Important" | "Nice to Have" | "Major Trip Focus"
  > = ["Not Important", "Nice to Have", "Major Trip Focus"];
  const lodgingTypeOptions = [
    "Hotel",
    "Boutique Hotel",
    "Vacation Rental",
    "Bed & Breakfast",
    "Resort",
    "Hostel",
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.foodPreferences.foodPriority) {
      setShowFoodPriorityError(true);
      return;
    }

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
          <div className="space-y-3 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Time of Year{" "}
              <span className="text-slate-400 font-normal">
                (Select months)
              </span>
            </label>
            <div className="flex flex-wrap gap-2">
              {monthOptions.map((month) => (
                <button
                  key={month}
                  type="button"
                  onClick={() => handleArrayToggle("timeOfYear", month)}
                  className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                    formData.timeOfYear.includes(month)
                      ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                      : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                  }`}
                >
                  {month}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-slate-700">
              Duration
            </label>
            <div className="flex gap-2">
              <input
                type="number"
                min="1"
                required
                value={formData.durationValue}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    durationValue: e.target.value
                      ? parseInt(e.target.value)
                      : "",
                  }))
                }
                className="w-2/3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                placeholder="e.g. 5"
              />
              <select
                value={formData.durationUnit}
                onChange={(e) =>
                  setFormData((p) => ({
                    ...p,
                    durationUnit: e.target.value as "days" | "weeks",
                  }))
                }
                className="w-1/3 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
              >
                <option value="days">Days</option>
                <option value="weeks">Weeks</option>
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="travelers"
              className="block text-sm font-medium text-slate-700"
            >
              Travel Style
            </label>
            <p className="text-xs text-slate-500">
              This describes who the trip is designed for and how the pacing
              should feel.
            </p>
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
              <option value="Solo">Solo - independent, flexible pacing</option>
              <option value="Couple">
                Couple - scenic, shared, lower-friction flow
              </option>
              <option value="Family">
                Family - simpler logistics, broader appeal
              </option>
              <option value="Friends">
                Friends - social, energetic, group-friendly pacing
              </option>
            </select>
          </div>

          <div className="space-y-3 md:col-span-2">
            <label className="block text-sm font-medium text-slate-700">
              Detailed Budget (USD)
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">
                  Lodging (per night)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={formData.budget.lodging}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        budget: { ...p.budget, lodging: e.target.value },
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                    placeholder="e.g. 150"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">
                  Local Transportation (total)
                </label>
                <p className="text-xs text-slate-400">
                  Once you are already at the destination.
                </p>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={formData.budget.localTransportation}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        budget: {
                          ...p.budget,
                          localTransportation: e.target.value,
                        },
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                    placeholder="e.g. 120"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">Food (per day)</label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={formData.budget.food}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        budget: { ...p.budget, food: e.target.value },
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                    placeholder="e.g. 100"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">
                  Activities & Misc (total)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500">
                    $
                  </span>
                  <input
                    type="number"
                    min="0"
                    value={formData.budget.misc}
                    onChange={(e) =>
                      setFormData((p) => ({
                        ...p,
                        budget: { ...p.budget, misc: e.target.value },
                      }))
                    }
                    className="w-full rounded-xl border border-slate-300 bg-white pl-8 pr-4 py-2 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
                    placeholder="e.g. 300"
                  />
                </div>
              </div>
            </div>
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
              Local Transportation{" "}
              <span className="text-slate-400 font-normal">
                (Select multiple)
              </span>
            </label>
            <p className="text-xs text-slate-500">
              Choose how you want to move around after arriving at the
              destination.
            </p>
            <div className="flex flex-wrap gap-2">
              {transportOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() =>
                    handleArrayToggle("localTransportation", option)
                  }
                  className={`px-4 py-2 rounded-xl border text-sm font-medium transition-colors ${
                    formData.localTransportation.includes(option)
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
            <label className="block text-sm font-medium text-slate-700">
              Preferred Location
            </label>
            <p className="text-xs text-slate-500 mb-2">
              Country and state/province are required. City is optional if you
              want the planner to choose the best fit within that region.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="text"
                value={formData.preferredLocation.country}
                onChange={(e) =>
                  handlePreferredLocationChange("country", e.target.value)
                }
                required
                placeholder="Country"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
              />
              <input
                type="text"
                value={formData.preferredLocation.stateOrProvince}
                onChange={(e) =>
                  handlePreferredLocationChange(
                    "stateOrProvince",
                    e.target.value,
                  )
                }
                required
                placeholder="State / Province"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
              />
              <input
                type="text"
                value={formData.preferredLocation.city}
                onChange={(e) =>
                  handlePreferredLocationChange("city", e.target.value)
                }
                placeholder="City (optional)"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="attractionInterests"
              className="block text-sm font-medium text-slate-700"
            >
              Attractions of Interest{" "}
              <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <input
              type="text"
              id="attractionInterests"
              name="attractionInterests"
              value={formData.attractionInterests}
              onChange={handleChange}
              placeholder="e.g., art museums, skyline viewpoints, historic district..."
              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-slate-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 outline-none transition-all"
            />
          </div>

          <div className="space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Food Preferences
            </label>

            <div className="space-y-2">
              <p className="text-xs text-slate-500">Dietary restrictions</p>
              <div className="flex flex-wrap gap-2">
                {dietaryRestrictionOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      handleFoodArrayToggle("dietaryRestrictions", option)
                    }
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                      formData.foodPreferences.dietaryRestrictions.includes(
                        option,
                      )
                        ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                        : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-500">Cuisine interests</p>
              <div className="flex flex-wrap gap-2">
                {cuisineInterestOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() =>
                      handleFoodArrayToggle("cuisineInterests", option)
                    }
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                      formData.foodPreferences.cuisineInterests.includes(option)
                        ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                        : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-500">Dining style</p>
              <div className="flex flex-wrap gap-2">
                {diningStyleOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleFoodArrayToggle("diningStyle", option)}
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                      formData.foodPreferences.diningStyle.includes(option)
                        ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                        : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs text-slate-500">Food importance</p>
              <div className="flex flex-wrap gap-2">
                {foodPriorityOptions.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => handleFoodPriorityChange(option)}
                    className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                      formData.foodPreferences.foodPriority === option
                        ? "bg-emerald-100 border-emerald-500 text-emerald-800"
                        : showFoodPriorityError
                          ? "bg-white border-red-300 text-slate-700 hover:border-red-400"
                          : "bg-white border-slate-300 text-slate-700 hover:border-emerald-500"
                    }`}
                    aria-pressed={formData.foodPreferences.foodPriority === option}
                  >
                    {option}
                  </button>
                ))}
              </div>
              {showFoodPriorityError ? (
                <p className="text-xs text-red-600">
                  Choose how important food is for this trip.
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-slate-700">
              Lodging Preferences{" "}
              <span className="text-slate-400 font-normal">
                (Select one or more)
              </span>
            </label>
            <p className="text-xs text-slate-500">
              Tell us what kinds of places you prefer staying in once you are at
              the destination.
            </p>
            <div className="flex flex-wrap gap-2">
              {lodgingTypeOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => handleLodgingTypeToggle(option)}
                  className={`px-3 py-1.5 rounded-xl border text-sm font-medium transition-colors ${
                    formData.lodgingPreferences.lodgingTypes.includes(option)
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

        <div className="pt-6 flex gap-4">
          <button
            type="button"
            onClick={() => {
              setFormData(defaultFormData);
              setShowFoodPriorityError(false);
            }}
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
