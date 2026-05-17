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
    lodging: string;
    localTransportation: string;
    food: string;
    misc: string;
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
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new RequestValidationError(`${fieldName} must be an array of strings.`);
  }

  return value;
}

function parseOptionalStringArray(value: unknown, fieldName: string) {
  if (typeof value === "undefined") return [];
  return parseStringArray(value, fieldName);
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

function parsePositiveNumber(value: unknown, fieldName: string) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new RequestValidationError(`${fieldName} must be a positive number.`);
  }

  return value;
}

function parseOptionalNumber(value: unknown, fieldName: string) {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RequestValidationError(`${fieldName} must be a number.`);
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
  const includeFood = parseOptionalBoolean(input.includeFood, "includeFood", true);
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
    timeOfYear: parseStringArray(input.timeOfYear, "timeOfYear"),
    durationValue: parsePositiveNumber(input.durationValue, "durationValue"),
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
      lodging: parseOptionalString(budget.lodging, "budget.lodging"),
      localTransportation: parseOptionalString(
        budget.localTransportation,
        "budget.localTransportation",
      ),
      food: parseOptionalString(budget.food, "budget.food"),
      misc: parseOptionalString(budget.misc, "budget.misc"),
    },
    primaryGoal: parseStringArray(input.primaryGoal, "primaryGoal"),
    foodPreferences: {
      dietaryRestrictions: parseOptionalStringArray(
        foodPreferences.dietaryRestrictions,
        "foodPreferences.dietaryRestrictions",
      ),
      cuisineInterests: parseOptionalStringArray(
        foodPreferences.cuisineInterests,
        "foodPreferences.cuisineInterests",
      ),
      diningStyle: parseOptionalStringArray(
        foodPreferences.diningStyle,
        "foodPreferences.diningStyle",
      ),
      foodPlaceTypes: parseOptionalStringArray(
        foodPreferences.foodPlaceTypes,
        "foodPreferences.foodPlaceTypes",
      ),
      foodPriority: includeFood
        ? parseStringEnum(
            foodPreferences.foodPriority,
            "foodPreferences.foodPriority",
            ["Not Important", "Nice to Have", "Major Trip Focus"],
          )
        : typeof foodPreferences.foodPriority === "undefined"
          ? ""
          : parseStringEnum(foodPreferences.foodPriority, "foodPreferences.foodPriority", [
              "Not Important",
              "Nice to Have",
              "Major Trip Focus",
              "",
            ]),
    },
    lodgingPreferences: {
      lodgingTypes: parseOptionalStringArray(
        lodgingPreferences.lodgingTypes,
        "lodgingPreferences.lodgingTypes",
      ),
    },
    localTransportation: parseStringArray(
      input.localTransportation,
      "localTransportation",
    ),
    preferredLocation: {
      country: parseString(preferredLocation.country, "preferredLocation.country", {
        allowEmpty: false,
      }),
      stateOrProvince: parseString(
        preferredLocation.stateOrProvince,
        "preferredLocation.stateOrProvince",
        { allowEmpty: true },
      ),
      city: parseOptionalString(preferredLocation.city, "preferredLocation.city"),
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
    title: parseString(input.title, "recommendation.title", { allowEmpty: false }),
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
  const limit =
    typeof input.limit === "undefined"
      ? 5
      : parseOptionalNumber(input.limit, "limit");

  if (!limit || limit <= 0) {
    throw new RequestValidationError("limit must be a positive number.");
  }

  return {
    query,
    limit,
    latitude: parseOptionalNumber(input.latitude, "latitude"),
    longitude: parseOptionalNumber(input.longitude, "longitude"),
  };
}
