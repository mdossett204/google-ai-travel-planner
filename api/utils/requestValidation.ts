export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export interface ValidatedTravelFormData {
  timeOfYear: string[];
  durationValue: number | "";
  durationUnit: "days" | "weeks";
  travelers: "Solo" | "Couple" | "Family" | "Friends" | "";
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
    foodPriority: "Not Important" | "Nice to Have" | "Major Trip Focus";
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

function parseNumberOrEmptyString(value: unknown, fieldName: string) {
  if (value === "") {
    return "";
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new RequestValidationError(
      `${fieldName} must be a non-negative number or an empty string.`,
    );
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
  const foodPreferences = requireRecord(
    input.foodPreferences,
    "foodPreferences",
  );
  const lodgingPreferences = requireRecord(
    input.lodgingPreferences,
    "lodgingPreferences",
  );
  const preferredLocation = requireRecord(
    input.preferredLocation,
    "preferredLocation",
  );

  return {
    timeOfYear: parseStringArray(input.timeOfYear, "timeOfYear"),
    durationValue: parseNumberOrEmptyString(input.durationValue, "durationValue"),
    durationUnit: parseStringEnum(input.durationUnit, "durationUnit", [
      "days",
      "weeks",
    ]),
    travelers: parseStringEnum(input.travelers, "travelers", [
      "",
      "Solo",
      "Couple",
      "Family",
      "Friends",
    ]),
    budget: {
      lodging: parseString(budget.lodging, "budget.lodging"),
      localTransportation: parseString(
        budget.localTransportation,
        "budget.localTransportation",
      ),
      food: parseString(budget.food, "budget.food"),
      misc: parseString(budget.misc, "budget.misc"),
    },
    primaryGoal: parseStringArray(input.primaryGoal, "primaryGoal"),
    foodPreferences: {
      dietaryRestrictions: parseStringArray(
        foodPreferences.dietaryRestrictions,
        "foodPreferences.dietaryRestrictions",
      ),
      cuisineInterests: parseStringArray(
        foodPreferences.cuisineInterests,
        "foodPreferences.cuisineInterests",
      ),
      diningStyle: parseStringArray(
        foodPreferences.diningStyle,
        "foodPreferences.diningStyle",
      ),
      foodPriority: parseStringEnum(
        foodPreferences.foodPriority,
        "foodPreferences.foodPriority",
        ["Not Important", "Nice to Have", "Major Trip Focus"],
      ),
    },
    lodgingPreferences: {
      lodgingTypes: parseStringArray(
        lodgingPreferences.lodgingTypes,
        "lodgingPreferences.lodgingTypes",
      ),
    },
    localTransportation: parseStringArray(
      input.localTransportation,
      "localTransportation",
    ),
    preferredLocation: {
      country: parseString(preferredLocation.country, "preferredLocation.country"),
      stateOrProvince: parseString(
        preferredLocation.stateOrProvince,
        "preferredLocation.stateOrProvince",
      ),
      city: parseString(preferredLocation.city, "preferredLocation.city"),
    },
    attractionInterests: parseString(
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
