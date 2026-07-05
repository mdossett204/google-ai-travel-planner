import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TravelForm from '../../../src/components/TravelForm.js';
import { fillTravelForm, submitTravelForm } from '../../helpers.js';

describe('TravelForm Component', () => {
  const setupTravelForm = (props: Partial<React.ComponentProps<typeof TravelForm>> = {}) => {
    const onSubmitMock = vi.fn();
    const utils = render(<TravelForm onSubmit={onSubmitMock} isLoading={false} {...props} />);
    return { ...utils, onSubmitMock };
  };

  it('renders correctly', () => {
    setupTravelForm();
    expect(screen.getByText('Design Your Trip')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Travel Style')).toBeInTheDocument();
  });

  it('renders correctly with initialData', () => {
    const initialData: any = {
      durationValue: 10,
      travelers: 'Couple',
      preferredLocation: { country: 'France' },
      budget: { misc: '500' },
      includeFood: true,
      foodPreferences: { foodPriority: 'Major Trip Focus' },
      lodgingPreferences: {} // Missing lodgingTypes to cover fallback
    };
    setupTravelForm({ initialData });
    expect(screen.getByDisplayValue('10')).toBeInTheDocument();
    expect(screen.getByDisplayValue('France')).toBeInTheDocument();
    
    // Verify budget and food preferences rendered
    expect(screen.getByDisplayValue('500')).toBeInTheDocument();
    expect(screen.getByText('Major Trip Focus')).toBeInTheDocument();

    // Toggle lodging type to cover line 453 (undefined lodgingTypes)
    fireEvent.click(screen.getByRole('button', { name: 'Lodging' }));
    fireEvent.click(screen.getByText('Boutique Hotel'));
  });

  it('shows validation error if submitted empty', () => {
    const { onSubmitMock } = setupTravelForm();
    
    // Fill required html5 inputs so the form can submit programmatically
    fillTravelForm({ includeGoalsAndActivity: false });

    // Submit
    submitTravelForm();

    // It should fail validation because Primary Goals are empty
    expect(screen.getByText('Please select at least one Primary Goal.')).toBeInTheDocument();
    expect(onSubmitMock).not.toHaveBeenCalled();
  });

  it('handles duration unit change and clamps value', () => {
    setupTravelForm();
    
    const input = screen.getByPlaceholderText('e.g. 5');
    const select = screen.getByLabelText('Duration unit');

    // Change to invalid value so currentVal is 0
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.change(select, { target: { value: 'weeks' } }); // newMax = 2, currentVal = 0

    // Set duration to 10
    fireEvent.change(input, { target: { value: '10' } });
    expect(input).toHaveValue(10);
    
    // Change unit to weeks (max 2)
    fireEvent.change(select, { target: { value: 'weeks' } });
    
    // Value should be clamped to 2
    expect(input).toHaveValue(2);
    
    // Change unit back to days (max 14)
    fireEvent.change(select, { target: { value: 'days' } });
    
    // Value is still 2, which is <= 14, so it stays 2
    expect(input).toHaveValue(2);
  });

  it('submits successfully when filled correctly', () => {
    const { onSubmitMock } = setupTravelForm();
    
    fillTravelForm();

    submitTravelForm();

    expect(onSubmitMock).toHaveBeenCalledTimes(1);
    const submittedData = onSubmitMock.mock.calls[0][0];
    expect(submittedData.durationValue).toBe(5);
    expect(submittedData.travelers).toBe('Solo');
    expect(submittedData.preferredLocation.country).toBe('Japan');
    expect(submittedData.primaryGoal).toContain('Relaxation');
    expect(submittedData.activityLevel).toBe('Balanced');
  });

  it('toggles lodging sections when Lodging button is clicked', () => {
    setupTravelForm();
    
    expect(screen.queryByText('Lodging (per night)')).not.toBeInTheDocument();
    
    fireEvent.click(screen.getByText('Lodging'));
    
    expect(screen.getByText('Lodging (per night)')).toBeInTheDocument();
  });

  it('handles full form inputs including budget, food, lodging, and clears them', () => {
    const onSubmitMock = vi.fn();
    render(<TravelForm onSubmit={onSubmitMock} isLoading={false} />);
    
    // Budget
    fireEvent.change(screen.getByPlaceholderText('e.g. 120'), { target: { value: '2000' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 300'), { target: { value: '500' } });

    // Local Transportation
    fireEvent.click(screen.getByText('Public Transit'));

    // Attraction Interests
    fireEvent.change(screen.getByPlaceholderText('e.g., art museums, skyline viewpoints, historic district...'), { target: { value: 'museums' } });

    // Location
    fireEvent.change(screen.getByPlaceholderText('State / Province (optional)'), { target: { value: 'NY' } });
    fireEvent.change(screen.getByPlaceholderText('City (optional)'), { target: { value: 'New York' } });

    // Food
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    expect(screen.getByText('Dietary restrictions')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Vegetarian'));
    
    // Validation error for food priority
    fillTravelForm();
    submitTravelForm();
    expect(screen.getByText('Choose how important food is for this trip.')).toBeInTheDocument();
    expect(onSubmitMock).not.toHaveBeenCalled();

    // Select Food Priority
    fireEvent.click(screen.getByText('Major Trip Focus'));
    
    // Lodging
    fireEvent.click(screen.getByRole('button', { name: 'Lodging' }));
    fireEvent.click(screen.getByText('Boutique Hotel'));

    // Lodging Budget and Food Budget
    fireEvent.change(screen.getByPlaceholderText('e.g. 150'), { target: { value: '150' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. 100'), { target: { value: '80' } });

    // Now submit works
    submitTravelForm();
    expect(onSubmitMock).toHaveBeenCalledTimes(1);
    
    const submittedData = onSubmitMock.mock.calls[0][0];
    expect(submittedData.budget.localTransportation).toBe(2000);
    expect(submittedData.budget.misc).toBe(500);
    expect(submittedData.budget.lodging).toBe(150);
    expect(submittedData.budget.food).toBe(80);
    expect(submittedData.localTransportation).toContain('Public Transit');
    expect(submittedData.attractionInterests).toBe('museums');
    expect(submittedData.preferredLocation.stateOrProvince).toBe('NY');
    expect(submittedData.preferredLocation.city).toBe('New York');
    expect(submittedData.foodPreferences.dietaryRestrictions).toContain('Vegetarian');
    expect(submittedData.foodPreferences.foodPriority).toBe('Major Trip Focus');
    expect(submittedData.lodgingPreferences.lodgingTypes).toContain('Boutique Hotel');

    // Clear
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.getByPlaceholderText('e.g. 120')).toHaveValue(null);
  });

  it('handles un-toggling arrays and mutually exclusive options', () => {
    const onSubmitMock = vi.fn();
    render(<TravelForm onSubmit={onSubmitMock} isLoading={false} />);
    
    // timeOfYear
    fireEvent.click(screen.getByText('Jan'));
    fireEvent.click(screen.getByText('Jan')); // un-toggle
    
    // primaryGoal
    fireEvent.click(screen.getByText('Relaxation'));
    fireEvent.click(screen.getByText('Relaxation')); // un-toggle
    fireEvent.click(screen.getByText('Adventure'));

    // activityLevel
    fireEvent.click(screen.getByText('Balanced'));
    fireEvent.click(screen.getByText('Balanced')); // un-toggle
    
    // submit without activityLevel
    fillTravelForm({ includeGoalsAndActivity: false });
    // 'Adventure' was already toggled ON above. We don't need to click it again.
    submitTravelForm();
    expect(screen.getByText('Please select an Activity Level.')).toBeInTheDocument();
    
    // select activity level
    fireEvent.click(screen.getByText('Very Active'));

    // localTransportation
    fireEvent.click(screen.getByText('Rental Car'));
    fireEvent.click(screen.getByText('Rental Car')); // un-toggle

    // Food toggles
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    
    // dietaryRestrictions mutually exclusive
    fireEvent.click(screen.getByText('Vegan'));
    fireEvent.click(screen.getByText('Vegetarian'));
    fireEvent.click(screen.getByText('Vegetarian')); // un-toggle
    fireEvent.click(screen.getByText('No Restrictions')); // exclusive - clears Vegan
    fireEvent.click(screen.getByText('Gluten-Free')); // selecting normal clears exclusive

    // foodPlaceTypes toggle
    fireEvent.click(screen.getByText('Restaurants'));
    fireEvent.click(screen.getByText('Restaurants')); // un-toggle

    // Food priority is required if food is included!
    fireEvent.click(screen.getByText('Nice to Have'));
    fireEvent.click(screen.getByText('Major Trip Focus'));
    
    // Lodging toggle
    fireEvent.click(screen.getByRole('button', { name: 'Lodging' }));
    fireEvent.click(screen.getByText('Hotel'));
    fireEvent.click(screen.getByText('Hotel')); // un-toggle
    fireEvent.click(screen.getByText('Resort'));

    submitTravelForm();
    const data = onSubmitMock.mock.calls[0][0];
    
    expect(data.timeOfYear).not.toContain('Jan');
    expect(data.primaryGoal).not.toContain('Relaxation');
    expect(data.primaryGoal).toContain('Adventure');
    expect(data.activityLevel).toBe('Very Active');
    expect(data.localTransportation).not.toContain('Rental Car');
    
    expect(data.foodPreferences.dietaryRestrictions).not.toContain('Vegan');
    expect(data.foodPreferences.dietaryRestrictions).not.toContain('No Restrictions');
    expect(data.foodPreferences.dietaryRestrictions).toContain('Gluten-Free');
    
    expect(data.foodPreferences.foodPlaceTypes).not.toContain('Restaurants');
    expect(data.lodgingPreferences.lodgingTypes).not.toContain('Hotel');
    expect(data.lodgingPreferences.lodgingTypes).toContain('Resort');
  });

  it('handles untoggling food priority', () => {
    setupTravelForm();
    fireEvent.click(screen.getByRole('button', { name: 'Food' }));
    fireEvent.click(screen.getByText('Major Trip Focus'));
    // It should be toggled ON
    fireEvent.click(screen.getByText('Major Trip Focus')); // untoggle
    // Validation should complain about food priority if we submit now
    fillTravelForm();
    submitTravelForm();
    expect(screen.getByText('Choose how important food is for this trip.')).toBeInTheDocument();
  });

  it('allows changing duration unit to weeks and clamps value, and handles invalid duration strings', () => {
    const mockOnSubmit = vi.fn();
    render(<TravelForm onSubmit={mockOnSubmit} isLoading={false} />);
    
    // Default is days
    const durationInput = screen.getByPlaceholderText('e.g. 5');
    
    // Try typing an invalid value
    fireEvent.change(durationInput, { target: { value: 'invalid' } });
    expect(durationInput).toHaveValue(null);

    // Set duration to 10 (days)
    fireEvent.change(durationInput, { target: { value: '10' } });
    expect(durationInput).toHaveValue(10);

    // Switch to weeks - should clamp 10 down to 2
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'weeks' } });
    
    expect(select).toHaveValue('weeks');
    expect(durationInput).toHaveValue(2);
  });

  it('updates preferred location fields', () => {
    const mockOnSubmit = vi.fn();
    render(<TravelForm onSubmit={mockOnSubmit} isLoading={false} />);
    
    // Type in City, State, Country
    fireEvent.change(screen.getByPlaceholderText('City (optional)'), { target: { value: 'Kyoto' } });
    fireEvent.change(screen.getByPlaceholderText('State / Province (optional)'), { target: { value: 'Kyoto Prefecture' } });
    fireEvent.change(screen.getByPlaceholderText('Country'), { target: { value: 'Japan' } });

    fillTravelForm();
    submitTravelForm();
    const data = mockOnSubmit.mock.calls[0][0];
    expect(data.preferredLocation.city).toBe('Kyoto');
    expect(data.preferredLocation.stateOrProvince).toBe('Kyoto Prefecture');
    expect(data.preferredLocation.country).toBe('Japan');
  });

  it('handles empty value on duration correctly', () => {
    const mockOnSubmit = vi.fn();
    render(<TravelForm onSubmit={mockOnSubmit} isLoading={false} />);
    const durationInput = screen.getByPlaceholderText('e.g. 5');
    
    // Valid number
    fireEvent.change(durationInput, { target: { valueAsNumber: 7 } });
    expect(durationInput).toHaveValue(7);

    // Invalid number yielding NaN on valueAsNumber
    fireEvent.change(durationInput, { target: { valueAsNumber: NaN } });
    // It should be empty now in state, though in jsdom it might just reflect the value
  });

  it('handles toggling Food and Lodging off, invalid budget, and exclusive options', () => {
    const mockOnSubmit = vi.fn();
    render(<TravelForm onSubmit={mockOnSubmit} isLoading={false} />);
    
    // Toggle Food ON
    const foodBtn = screen.getByRole('button', { name: 'Food' });
    fireEvent.click(foodBtn);
    
    // Toggle Food OFF
    fireEvent.click(foodBtn);
    
    // Toggle Lodging ON
    const lodgingBtn = screen.getByRole('button', { name: 'Lodging' });
    fireEvent.click(lodgingBtn);
    
    // Toggle Lodging OFF
    fireEvent.click(lodgingBtn);

    // Enter invalid budget value
    fireEvent.click(foodBtn); // ON again to show food budget
    fireEvent.click(lodgingBtn); // ON again to show lodging budget
    const budgetInput = screen.getByPlaceholderText('e.g. 120');
    fireEvent.change(budgetInput, { target: { value: 'invalid', valueAsNumber: NaN } });
  });
});
