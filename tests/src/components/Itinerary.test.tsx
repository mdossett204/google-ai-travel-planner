import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import Itinerary from '../../../src/components/Itinerary.js';

describe('Itinerary Component', () => {
  const mockRecommendation = {
    id: 'rec-1',
    title: 'Kyoto Cultural Trip',
    description: 'A trip to Kyoto.',
    highlights: ['Temples'],
    estimatedCost: '$1,000',
    bestTimeToGo: 'Spring'
  };

  const mockItineraryMarkdown = '# Day 1\nVisit the Golden Pavilion.';

  it('renders title and markdown content', () => {
    render(
      <Itinerary
        recommendation={mockRecommendation}
        itinerary={mockItineraryMarkdown}
        onBack={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    expect(screen.getByText('Kyoto Cultural Trip')).toBeInTheDocument();
    // Check if the markdown rendered the header
    expect(screen.getByText('Day 1')).toBeInTheDocument();
    expect(screen.getByText('Visit the Golden Pavilion.')).toBeInTheDocument();
  });

  it('calls onBack when Back to Options is clicked', () => {
    const onBackMock = vi.fn();
    render(
      <Itinerary
        recommendation={mockRecommendation}
        itinerary={mockItineraryMarkdown}
        onBack={onBackMock}
        onRestart={vi.fn()}
      />
    );

    const backButton = screen.getByText('Back to Options');
    fireEvent.click(backButton);
    expect(onBackMock).toHaveBeenCalledTimes(1);
  });

  it('calls onRestart when Start Over is clicked', () => {
    const onRestartMock = vi.fn();
    render(
      <Itinerary
        recommendation={mockRecommendation}
        itinerary={mockItineraryMarkdown}
        onBack={vi.fn()}
        onRestart={onRestartMock}
      />
    );

    const restartButton = screen.getByText('Start Over');
    fireEvent.click(restartButton);
    expect(onRestartMock).toHaveBeenCalledTimes(1);
  });

  it('triggers download when Save Plan is clicked', () => {
    // Mock the DOM methods for creating and clicking a link
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    const mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    
    render(
      <Itinerary
        recommendation={mockRecommendation}
        itinerary={mockItineraryMarkdown}
        onBack={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'a') return mockAnchor as any;
      return originalCreateElement(tagName);
    });
    
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);

    const downloadButton = screen.getByText('Save Plan');
    fireEvent.click(downloadButton);

    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(mockAnchor.download).toBe('Kyoto_Cultural_Trip_Itinerary.md');
    expect(mockAnchor.click).toHaveBeenCalledTimes(1);

    // Restore globals
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });

  it('uses default name Travel if title is empty or special chars', () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();

    const mockAnchor = {
      href: '',
      download: '',
      click: vi.fn(),
    };
    
    render(
      <Itinerary
        recommendation={{ ...mockRecommendation, title: '___ ' }}
        itinerary={mockItineraryMarkdown}
        onBack={vi.fn()}
        onRestart={vi.fn()}
      />
    );

    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      if (tagName === 'a') return mockAnchor as any;
      return originalCreateElement(tagName);
    });
    
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);

    fireEvent.click(screen.getByText('Save Plan'));

    expect(mockAnchor.download).toBe('Travel_Itinerary.md');

    // Restore globals
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    vi.restoreAllMocks();
  });
});
