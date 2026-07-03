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
