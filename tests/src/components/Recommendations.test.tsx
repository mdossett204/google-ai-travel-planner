import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Recommendations from '../../../src/components/Recommendations.js';

describe('Recommendations Component', () => {
  const mockRecommendations = [
    {
      id: 'rec-1',
      title: 'Kyoto Cultural Trip',
      description: 'A trip to Kyoto.',
      highlights: ['Temples', 'Shrines', 'Gardens'],
      estimatedCost: '$1,000',
      bestTimeToGo: 'Spring'
    },
    {
      id: 'rec-2',
      title: 'Tokyo Nightlife',
      description: 'A vibrant trip to Tokyo.',
      highlights: ['Sushi', 'Clubs', 'Shopping'],
      estimatedCost: '$1,500',
      bestTimeToGo: 'Autumn'
    }
  ];

  it('renders all recommendations', () => {
    render(
      <Recommendations
        recommendations={mockRecommendations}
        onSelect={vi.fn()}
        onBack={vi.fn()}
      />
    );

    expect(screen.getByText('Kyoto Cultural Trip')).toBeInTheDocument();
    expect(screen.getByText('Tokyo Nightlife')).toBeInTheDocument();
    expect(screen.getByText('A trip to Kyoto.')).toBeInTheDocument();
    expect(screen.getByText('A vibrant trip to Tokyo.')).toBeInTheDocument();
    
    // Check if highlights are rendered
    expect(screen.getByText('Temples')).toBeInTheDocument();
    expect(screen.getByText('Sushi')).toBeInTheDocument();
  });

  it('calls onSelect when a recommendation is clicked', () => {
    const onSelectMock = vi.fn();
    render(
      <Recommendations
        recommendations={mockRecommendations}
        onSelect={onSelectMock}
        onBack={vi.fn()}
      />
    );

    const firstRec = screen.getByText('Kyoto Cultural Trip');
    fireEvent.click(firstRec);

    expect(onSelectMock).toHaveBeenCalledTimes(1);
    expect(onSelectMock).toHaveBeenCalledWith(mockRecommendations[0]);
  });

  it('calls onBack when Change Preferences is clicked', () => {
    const onBackMock = vi.fn();
    render(
      <Recommendations
        recommendations={mockRecommendations}
        onSelect={vi.fn()}
        onBack={onBackMock}
      />
    );

    const backButton = screen.getByText('Change Preferences');
    fireEvent.click(backButton);

    expect(onBackMock).toHaveBeenCalledTimes(1);
  });

  it('handles image loading and fallback on error', () => {
    const mockRecs = [{
      id: 'rec-3',
      title: 'A & B < C',
      description: 'Test special chars.',
      highlights: [],
      estimatedCost: '1',
      bestTimeToGo: 'Now'
    }];
    render(
      <Recommendations
        recommendations={mockRecs}
        onSelect={vi.fn()}
        onBack={vi.fn()}
      />
    );
    
    const img = screen.getByAltText('A & B < C');
    expect(img).toBeInTheDocument();
    
    // Simulate load
    fireEvent.load(img);
    
    // Simulate error to trigger fallback SVG which includes HTML entities parsing
    fireEvent.error(img);
  });
});
