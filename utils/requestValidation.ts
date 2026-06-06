export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export interface ValidatedTravelFormData {
  timeOfYear: string[];
  durationValue: number;
  durationUnit: "days" | "weeks";
  travelers: "Solo" | "Couple" | "Family" | "Friends";
  includeLodging: boolean;
  includeFood: boolean;
  activityLevel: "Relaxed" | "Balanced" | "Very Active" | "";
  budget: {
    lodging?: number;
    localTransportation?: number;
    food?: number;
    misc?: number;
  };
  primaryGoal: string[];
  foodPreferences: {
    dietaryRestrictions: string[];
    cuisineInterests: string[];
    diningStyle: string[];
    foodPlaceTypes: string[];
    foodPriority: "Not Important" | "Nice to Have" | "Major Trip Focus" | "";
  };
  lodgingPreferences: {
    lodgingTypes: string[];
  };
  localTransportation: string[];
  preferredLocation: {
    country: string;
    stateOrProvince: string;
    city: string;
  };
  attractionInterests: string;
}

export interface ValidatedRecommendation {
  id: string;
  title: string;
  description: string;
  highlights: string[];
  estimatedCost: string;
  bestTimeToGo: string;
}

export interface ValidatedItineraryRequest {
  data: ValidatedTravelFormData;
  recommendation: ValidatedRecommendation;
}

export interface ValidatedTomTomPoiSearchRequest {
  query: string;
  limit: number;
  latitude?: number;
  longitude?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const ALLOWED_PRIMARY_GOALS = [
  "Relaxation",
  "Adventure",
  "Hiking",
  "Cultural Exploration",
  "Nature & Wildlife",
  "Food & Culinary",
  "Party & Nightlife",
] as const;

const ALLOWED_TRANSPORT_OPTIONS = [
  "Public Transit",
  "Rental Car",
  "Walking/Biking",
  "Taxis/Rideshare",
  "Own Car",
] as const;

const ALLOWED_DIETARY_RESTRICTIONS = [
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
] as const;

const ALLOWED_CUISINE_INTERESTS = [
  "Seafood",
  "Regional Specialties",
  "Ethnic",
  "Street Food",
  "Cafe/Bakery",
  "No Preference",
] as const;

const ALLOWED_DINING_STYLES = [
  "Casual",
  "Quick Meals",
  "Family-Friendly",
  "Scenic Dining",
  "Fine Dining",
] as const;

const ALLOWED_FOOD_PLACE_TYPES = [
  "Restaurants",
  "Cafes/Bakeries",
  "Grocery Stores",
] as const;

const ALLOWED_LODGING_TYPES = [
  "Hotel",
  "Boutique Hotel",
  "Vacation Rental",
  "Bed & Breakfast",
  "Resort",
  "Hostel",
] as const;

const MAX_BUDGET = 20000;
const MAX_DURATION_VALUE = 14;
const MAX_TOMTOM_LIMIT = 20;

function requireRecord(value: unknown, fieldName: string) {
  if (!isRecord(value)) {
    throw new RequestValidationError(`${fieldName} must be an object.`);
  }
  return value;
}

function parseString(
  value: unknown,
  fieldName: string,
  { allowEmpty = true }: { allowEmpty?: boolean } = {},
) {
  if (typeof value !== "string") {
    throw new RequestValidationError(`${fieldName} must be a string.`);
  }

  if (!allowEmpty && !value.trim()) {
    throw new RequestValidationError(`${fieldName} is required.`);
  }

  return value;
}

function parseOptionalString(value: unknown, fieldName: string) {
  if (typeof value === "undefined") {
    return "";
  }
  return parseString(value, fieldName);
}

function parseStringArray(value: unknown, fieldName: string) {
  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string")
  ) {
    throw new RequestValidationError(
      `${fieldName} must be an array of strings.`,
    );
  }

  return value;
}

function parseOptionalStringArray(value: unknown, fieldName: string) {
  if (typeof value === "undefined") return [];
  return parseStringArray(value, fieldName);
}

function parseOptionalStringEnumArray<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
) {
  const values = parseOptionalStringArray(value, fieldName);
  for (const item of values) {
    if (!allowedValues.includes(item as T)) {
      throw new RequestValidationError(
        `${fieldName} must contain only: ${allowedValues.join(", ")}.`,
      );
    }
  }
  return values as T[];
}

function parseOptionalBoolean(
  value: unknown,
  fieldName: string,
  defaultValue: boolean,
) {
  if (typeof value === "undefined") return defaultValue;
  if (typeof value !== "boolean") {
    throw new RequestValidationError(`${fieldName} must be a boolean.`);
  }
  return value;
}

function parseStringEnum<T extends string>(
  value: unknown,
  fieldName: string,
  allowedValues: readonly T[],
) {
  if (typeof value !== "string" || !allowedValues.includes(value as T)) {
    throw new RequestValidationError(
      `${fieldName} must be one of: ${allowedValues.join(", ")}.`,
    );
  }

  return value as T;
}

function parsePositiveNumber(
  value: unknown,
  fieldName: string,
  { max }: { max?: number } = {},
) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RequestValidationError(`${fieldName} must be a positive number.`);
  }
  if (max !== undefined && value > max) {
    throw new RequestValidationError(`${fieldName} cannot exceed ${max}.`);
  }
  return value;
}

function parseOptionalNumber(
  value: unknown,
  fieldName: string,
  { max }: { max?: number } = {},
) {
  if (typeof value === "undefined" || value === "" || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestValidationError(`${fieldName} must be a number.`);
  }
  if (max !== undefined && value > max) {
    throw new RequestValidationError(`${fieldName} cannot exceed ${max}.`);
  }
  return value;
}

export function validateTravelFormData(raw: unknown): ValidatedTravelFormData {
  const input = requireRecord(raw, "Request body");
  const budget = requireRecord(input.budget, "budget");
  const preferredLocation = requireRecord(
    input.preferredLocation,
    "preferredLocation",
  );

  // Default to true for backwards compatibility with older clients.
  const includeFood = parseOptionalBoolean(
    input.includeFood,
    "includeFood",
    true,
  );
  const includeLodging = parseOptionalBoolean(
    input.includeLodging,
    "includeLodging",
    true,
  );

  const foodPreferences = includeFood
    ? requireRecord(input.foodPreferences, "foodPreferences")
    : isRecord(input.foodPreferences)
      ? input.foodPreferences
      : {};

  const lodgingPreferences = includeLodging
    ? requireRecord(input.lodgingPreferences, "lodgingPreferences")
    : isRecord(input.lodgingPreferences)
      ? input.lodgingPreferences
      : {};

  return {
    timeOfYear: parseOptionalStringEnumArray(input.timeOfYear, "timeOfYear", [
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
    ]),
    durationValue: parsePositiveNumber(input.durationValue, "durationValue", {
      max: MAX_DURATION_VALUE,
    }),
    durationUnit: parseStringEnum(input.durationUnit, "durationUnit", [
      "days",
      "weeks",
    ]),
    travelers: parseStringEnum(input.travelers, "travelers", [
      "Solo",
      "Couple",
      "Family",
      "Friends",
    ]),
    includeFood,
    includeLodging,
    activityLevel:
      typeof input.activityLevel === "undefined"
        ? ""
        : parseStringEnum(input.activityLevel, "activityLevel", [
            "Relaxed",
            "Balanced",
            "Very Active",
            "",
          ]),
    budget: {
      lodging: parseOptionalNumber(budget.lodging, "budget.lodging", { max: MAX_BUDGET }),
      localTransportation: parseOptionalNumber(
        budget.localTransportation,
        "budget.localTransportation",
        { max: MAX_BUDGET },
      ),
      food: parseOptionalNumber(budget.food, "budget.food", { max: MAX_BUDGET }),
      misc: parseOptionalNumber(budget.misc, "budget.misc", { max: MAX_BUDGET }),
    },
    primaryGoal: parseOptionalStringEnumArray(
      input.primaryGoal,
      "primaryGoal",
      ALLOWED_PRIMARY_GOALS,
    ),
    foodPreferences: {
      dietaryRestrictions: parseOptionalStringEnumArray(
        foodPreferences.dietaryRestrictions,
        "foodPreferences.dietaryRestrictions",
        ALLOWED_DIETARY_RESTRICTIONS,
      ),
      cuisineInterests: parseOptionalStringEnumArray(
        foodPreferences.cuisineInterests,
        "foodPreferences.cuisineInterests",
        ALLOWED_CUISINE_INTERESTS,
      ),
      diningStyle: parseOptionalStringEnumArray(
        foodPreferences.diningStyle,
        "foodPreferences.diningStyle",
        ALLOWED_DINING_STYLES,
      ),
      foodPlaceTypes: parseOptionalStringEnumArray(
        foodPreferences.foodPlaceTypes,
        "foodPreferences.foodPlaceTypes",
        ALLOWED_FOOD_PLACE_TYPES,
      ),
      foodPriority: includeFood
        ? parseStringEnum(
            foodPreferences.foodPriority,
            "foodPreferences.foodPriority",
            ["Not Important", "Nice to Have", "Major Trip Focus"],
          )
        : typeof foodPreferences.foodPriority === "undefined"
          ? ""
          : parseStringEnum(
              foodPreferences.foodPriority,
              "foodPreferences.foodPriority",
              ["Not Important", "Nice to Have", "Major Trip Focus", ""],
            ),
    },
    lodgingPreferences: {
      lodgingTypes: parseOptionalStringEnumArray(
        lodgingPreferences.lodgingTypes,
        "lodgingPreferences.lodgingTypes",
        ALLOWED_LODGING_TYPES,
      ),
    },
    localTransportation: parseOptionalStringEnumArray(
      input.localTransportation,
      "localTransportation",
      ALLOWED_TRANSPORT_OPTIONS,
    ),
    preferredLocation: {
      country: parseString(
        preferredLocation.country,
        "preferredLocation.country",
        {
          allowEmpty: false,
        },
      ),
      stateOrProvince: parseOptionalString(
        preferredLocation.stateOrProvince,
        "preferredLocation.stateOrProvince",
      ),
      city: parseOptionalString(
        preferredLocation.city,
        "preferredLocation.city",
      ),
    },
    attractionInterests: parseOptionalString(
      input.attractionInterests,
      "attractionInterests",
    ),
  };
}

export function validateRecommendation(raw: unknown): ValidatedRecommendation {
  const input = requireRecord(raw, "recommendation");

  return {
    id: parseString(input.id, "recommendation.id", { allowEmpty: false }),
    title: parseString(input.title, "recommendation.title", {
      allowEmpty: false,
    }),
    description: parseString(input.description, "recommendation.description", {
      allowEmpty: false,
    }),
    highlights: parseStringArray(input.highlights, "recommendation.highlights"),
    estimatedCost: parseString(
      input.estimatedCost,
      "recommendation.estimatedCost",
      { allowEmpty: false },
    ),
    bestTimeToGo: parseString(
      input.bestTimeToGo,
      "recommendation.bestTimeToGo",
      { allowEmpty: false },
    ),
  };
}

export function validateItineraryRequest(
  raw: unknown,
): ValidatedItineraryRequest {
  const input = requireRecord(raw, "Request body");

  return {
    data: validateTravelFormData(input.data),
    recommendation: validateRecommendation(input.recommendation),
  };
}

export function validateRecommendationsResponse(raw: unknown) {
  if (!Array.isArray(raw)) {
    throw new RequestValidationError(
      "AI response must be an array of recommendations.",
    );
  }

  if (raw.length !== 3) {
    throw new RequestValidationError(
      "AI response must contain exactly 3 recommendations.",
    );
  }

  return raw.map((item, index) => {
    const recommendation = validateRecommendation(item);

    if (
      recommendation.highlights.length < 3 ||
      recommendation.highlights.length > 4
    ) {
      throw new RequestValidationError(
        `recommendation[${index}].highlights must contain 3 to 4 items.`,
      );
    }

    return recommendation;
  });
}

export function validateTomTomPoiSearchRequest(
  raw: unknown,
): ValidatedTomTomPoiSearchRequest {
  const input = requireRecord(raw, "Request body");
  const query = parseString(input.query, "query", { allowEmpty: false }).trim();
  const limitRaw =
    typeof input.limit === "undefined"
      ? 5
      : parseOptionalNumber(input.limit, "limit");

  if (!limitRaw || limitRaw <= 0) {
    throw new RequestValidationError("limit must be a positive number.");
  }
  if (limitRaw > MAX_TOMTOM_LIMIT) {
    throw new RequestValidationError(`limit cannot exceed ${MAX_TOMTOM_LIMIT}.`);
  }
  const limit: number = limitRaw;

  return {
    query,
    limit,
    latitude: parseOptionalNumber(input.latitude, "latitude"),
    longitude: parseOptionalNumber(input.longitude, "longitude"),
  };
}
