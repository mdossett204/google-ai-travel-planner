import { screen, fireEvent } from '@testing-library/react';

export function fillTravelForm(options = { includeGoalsAndActivity: true }) {
  fireEvent.change(screen.getByPlaceholderText('e.g. 5'), { target: { value: '5' } });
  fireEvent.change(screen.getByRole('combobox', { name: /Travel Style/i }), { target: { value: 'Solo' } });
  fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'Japan' } });
  
  if (options.includeGoalsAndActivity) {
    fireEvent.click(screen.getByText('Relaxation'));
    fireEvent.click(screen.getByText('Balanced'));
  }
}

export function submitTravelForm() {
  fireEvent.click(screen.getByRole('button', { name: /Get Recommendations/i }));
}

import { expect } from 'vitest';

export async function assertToolDelegation(
  executeToolFn: (context: any) => Promise<any>,
  executeProviderToolMock: any,
  expectedLabel: string,
  args: any = { location: 'Test' }
) {
  const mockResult = { ok: true };
  executeProviderToolMock.mockResolvedValueOnce(mockResult);

  const context = { name: 'search_place', args };

  const result = await executeToolFn(context);

  expect(executeProviderToolMock).toHaveBeenCalledWith(
    'search_place',
    args,
    expectedLabel
  );
  expect(result).toBe(mockResult);
}

export function getMockTravelFormData(overrides = {}) {
  return {
    timeOfYear: [],
    durationValue: 5,
    durationUnit: 'days',
    travelers: 'Solo',
    preferredLocation: { country: 'Japan', city: 'Tokyo' },
    primaryGoal: [],
    activityLevel: 'Balanced',
    foodPreferences: { dietaryRestrictions: [], cuisineInterests: [], diningStyle: [], foodPlaceTypes: [], foodPriority: 'Major Trip Focus' },
    budget: { lodging: 100, localTransportation: 50, food: 50, misc: 50 },
    lodgingPreferences: { lodgingTypes: [] },
    localTransportation: [],
    includeLodging: true,
    includeFood: true,
    attractionInterests: '',
    ...overrides
  };
}

export function getMockItineraryRequestData(dataOverrides = {}, recommendationOverrides = {}) {
  return {
    data: getMockTravelFormData({ durationValue: 3, ...dataOverrides }),
    recommendation: {
      id: 'tokyo-food',
      title: 'Tokyo Food Tour',
      description: 'A great food tour.',
      highlights: ['Sushi', 'Ramen', 'Tempura'],
      estimatedCost: '$1,500',
      bestTimeToGo: 'Spring',
      ...recommendationOverrides
    }
  };
}
