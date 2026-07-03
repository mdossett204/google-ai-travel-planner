import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App, { ErrorBoundary } from '../../src/App.js';
import * as geminiService from '../../src/services/geminiService.js';
import { fillTravelForm, submitTravelForm } from '../helpers.js';

// Mock the API service
vi.mock('../../src/services/geminiService.js', () => ({
  getRecommendations: vi.fn(),
  getItinerary: vi.fn(),
}));

describe('App Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders ErrorBoundary fallback on unhandled error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ThrowError = () => { throw new Error('Test error'); };
    
    render(
      <ErrorBoundary>
        <ThrowError />
      </ErrorBoundary>
    );

    expect(screen.getByText('Oops, something went wrong.')).toBeInTheDocument();
    
    const reloadMock = vi.spyOn(window.location, 'reload').mockImplementation(() => {});
    fireEvent.click(screen.getByText('Reload Page'));
    expect(reloadMock).toHaveBeenCalled();
    
    consoleError.mockRestore();
    reloadMock.mockRestore();
  });

  it('renders TravelForm initially', () => {
    render(<App />);
    expect(screen.getByText('Design Your Trip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get Recommendations/i })).toBeInTheDocument();
  });

  it('progresses from TravelForm to Recommendations to Itinerary', async () => {
    const mockRecommendations = [
      {
        id: 'rec-1',
        title: 'Kyoto Cultural Trip',
        description: 'A trip to Kyoto.',
        highlights: ['Temples'],
        estimatedCost: '$1,000',
        bestTimeToGo: 'Spring'
      }
    ];

    const mockItineraryText = '# Kyoto Itinerary\nDay 1: Temples';

    vi.mocked(geminiService.getRecommendations).mockResolvedValue(mockRecommendations);
    vi.mocked(geminiService.getItinerary).mockResolvedValue(mockItineraryText);

    render(<App />);
    
    // Fill required form fields
    fillTravelForm();

    // Submit form
    submitTravelForm();

    // Wait for the recommendations component to appear
    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });
    
    expect(geminiService.getRecommendations).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Kyoto Cultural Trip')).toBeInTheDocument();

    // Click on the recommendation
    fireEvent.click(screen.getByText('Kyoto Cultural Trip'));

    // Wait for the itinerary to appear
    await waitFor(() => {
      expect(screen.getByText('Your detailed travel plan and tips.')).toBeInTheDocument();
    });

    expect(geminiService.getItinerary).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Day 1: Temples')).toBeInTheDocument();

    // Check back button to recommendations
    fireEvent.click(screen.getByText('Back to Options'));
    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });
    
    // Check back button to form
    fireEvent.click(screen.getByText('Change Preferences'));
    await waitFor(() => {
      expect(screen.getByText('Design Your Trip')).toBeInTheDocument();
    });
  });

  it('displays error messages when API fails', async () => {
    vi.mocked(geminiService.getRecommendations).mockRejectedValue(new Error('Network error'));

    render(<App />);
    
    // Fill required form fields
    fillTravelForm();

    // Submit form
    submitTravelForm();

    // Wait for error message
    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    // Dismiss error
    fireEvent.click(screen.getByText('Dismiss'));
    expect(screen.queryByText('Network error')).not.toBeInTheDocument();
  });

  it('displays error when getting itinerary fails', async () => {
    const mockRecommendations = [
      { id: 'rec-1', title: 'Kyoto Cultural Trip', description: 'desc', highlights: [], estimatedCost: '$1k', bestTimeToGo: 'Spring' }
    ];
    vi.mocked(geminiService.getRecommendations).mockResolvedValue(mockRecommendations);
    vi.mocked(geminiService.getItinerary).mockResolvedValue(null);

    render(<App />);
    fillTravelForm();
    submitTravelForm();

    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Kyoto Cultural Trip'));

    await waitFor(() => {
      expect(screen.getByText("Couldn't generate the itinerary. Please try again.")).toBeInTheDocument();
    });
  });

  it('can restart from the itinerary view', async () => {
    const mockRecommendations = [
      { id: 'rec-1', title: 'Kyoto Cultural Trip', description: 'desc', highlights: [], estimatedCost: '$1k', bestTimeToGo: 'Spring' }
    ];
    vi.mocked(geminiService.getRecommendations).mockResolvedValue(mockRecommendations);
    vi.mocked(geminiService.getItinerary).mockResolvedValue('Itinerary Data');

    render(<App />);
    fillTravelForm();
    submitTravelForm();

    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Kyoto Cultural Trip'));

    await waitFor(() => {
      expect(screen.getByText('Itinerary Data')).toBeInTheDocument();
    });
    
    // Restart
    fireEvent.click(screen.getByText('Start Over'));
    
    await waitFor(() => {
      expect(screen.getByText('Design Your Trip')).toBeInTheDocument();
    });
  });

  it('uses cached itinerary if selecting the same recommendation again and skips refetching if form unchanged', async () => {
    const mockRecommendations = [
      { id: 'rec-1', title: 'Kyoto Cultural Trip', description: 'desc', highlights: [], estimatedCost: '$1k', bestTimeToGo: 'Spring' }
    ];
    vi.mocked(geminiService.getRecommendations).mockResolvedValue(mockRecommendations);
    vi.mocked(geminiService.getItinerary).mockResolvedValue('Itinerary Data');

    render(<App />);
    fillTravelForm();
    submitTravelForm();

    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Kyoto Cultural Trip'));

    await waitFor(() => {
      expect(screen.getByText('Itinerary Data')).toBeInTheDocument();
    });
    expect(geminiService.getItinerary).toHaveBeenCalledTimes(1);

    // Go back to recommendations
    fireEvent.click(screen.getByText('Back to Options'));
    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });

    // Go back to form
    fireEvent.click(screen.getByText('Change Preferences'));
    await waitFor(() => {
      expect(screen.getByText('Design Your Trip')).toBeInTheDocument();
    });

    // Submit form again without changes
    submitTravelForm();
    await waitFor(() => {
      expect(screen.getByText('Your Travel Options')).toBeInTheDocument();
    });
    // Should not call getRecommendations again
    expect(geminiService.getRecommendations).toHaveBeenCalledTimes(1);

    // Select the recommendation again
    fireEvent.click(screen.getByText('Kyoto Cultural Trip'));

    await waitFor(() => {
      expect(screen.getByText('Itinerary Data')).toBeInTheDocument();
    });
    // Should not call getItinerary again
    expect(geminiService.getItinerary).toHaveBeenCalledTimes(1);
  });

  it('displays error when getting recommendations returns empty array', async () => {
    vi.mocked(geminiService.getRecommendations).mockResolvedValue([]);

    render(<App />);
    fillTravelForm();
    submitTravelForm();

    await waitFor(() => {
      expect(screen.getByText("Couldn't generate recommendations. Please try again.")).toBeInTheDocument();
    });
  });
});
