import { describe, it, expect } from 'vitest';
import { formatFoodPreferences } from '../../utils/foodPreferences.js';

describe('formatFoodPreferences', () => {
  it('formats full food preferences correctly', () => {
    const input = {
      dietaryRestrictions: ['Vegan', 'Gluten-Free'],
      cuisineInterests: ['Italian', 'Japanese'],
      diningStyle: ['Fine Dining', 'Casual'],
      foodPlaceTypes: ['Restaurant', 'Cafe'],
      foodPriority: 'High',
    };

    const result = formatFoodPreferences(input);

    expect(result).toContain('- Food Stops: Restaurant, Cafe');
    expect(result).toContain('- Dietary Restrictions: Vegan, Gluten-Free');
    expect(result).toContain('- Cuisine Interests: Italian, Japanese');
    expect(result).toContain('- Dining Style: Fine Dining, Casual');
    expect(result).toContain('- Food Priority: High');
  });

  it('handles missing or empty fields by providing fallbacks', () => {
    const input = {};

    const result = formatFoodPreferences(input);

    expect(result).toContain('- Food Stops: None specified');
    expect(result).toContain('- Dietary Restrictions: None specified');
    expect(result).toContain('- Cuisine Interests: None specified');
    expect(result).toContain('- Dining Style: None specified');
    expect(result).toContain('- Food Priority: Not specified');
  });

  it('sanitizes input properly', () => {
    const input = {
      foodPriority: 'High <script>',
    };

    const result = formatFoodPreferences(input);

    expect(result).toContain('- Food Priority: High &lt;script&gt;');
  });
});
