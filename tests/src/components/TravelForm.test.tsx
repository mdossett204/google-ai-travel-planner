import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import TravelForm from '../../../src/components/TravelForm.js';
import { fillTravelForm, submitTravelForm } from '../../helpers.js';

describe('TravelForm Component', () => {
  it('renders correctly', () => {
    render(<TravelForm onSubmit={vi.fn()} isLoading={false} />);
    expect(screen.getByText('Design Your Trip')).toBeInTheDocument();
    expect(screen.getByText('Duration')).toBeInTheDocument();
    expect(screen.getByText('Travel Style')).toBeInTheDocument();
  });

  it('shows validation error if submitted empty', () => {
    const onSubmitMock = vi.fn();
    render(<TravelForm onSubmit={onSubmitMock} isLoading={false} />);
    
    // Fill required html5 inputs so the form can submit programmatically
    fillTravelForm({ includeGoalsAndActivity: false });

    // Submit
    submitTravelForm();

    // It should fail validation because Primary Goals are empty
    expect(screen.getByText('Please select at least one Primary Goal.')).toBeInTheDocument();
    expect(onSubmitMock).not.toHaveBeenCalled();
  });

  it('submits successfully when filled correctly', () => {
    const onSubmitMock = vi.fn();
    render(<TravelForm onSubmit={onSubmitMock} isLoading={false} />);
    
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
    render(<TravelForm onSubmit={vi.fn()} isLoading={false} />);
    
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

    // Now submit works
    submitTravelForm();
    expect(onSubmitMock).toHaveBeenCalledTimes(1);
    
    const submittedData = onSubmitMock.mock.calls[0][0];
    expect(submittedData.budget.localTransportation).toBe(2000);
    expect(submittedData.budget.misc).toBe(500);
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

  it('allows changing duration unit to weeks', () => {
    const mockOnSubmit = vi.fn();
    render(<TravelForm onSubmit={mockOnSubmit} isSubmitting={false} />);
    
    // Default is days, switch to weeks
    const select = screen.getAllByRole('combobox')[0];
    fireEvent.change(select, { target: { value: 'weeks' } });
    
    expect(select).toHaveValue('weeks');
  });
});
