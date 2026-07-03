import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  formatTimeOfYear,
  formatList,
  sanitizePromptInput,
  enforcePostMethod,
  handleApiError,
  ApiResponse,
  ApiRequest
} from '../../utils/apiHelpers.js';

describe('apiHelpers', () => {
  describe('formatTimeOfYear', () => {
    it('formats recognized months correctly', () => {
      expect(formatTimeOfYear(['Jan', 'Feb'])).toBe('January (winter), February (late winter)');
    });

    it('returns fallback if array is empty', () => {
      expect(formatTimeOfYear([], 'Custom fallback')).toBe('Custom fallback');
    });

    it('leaves unrecognized months as they are', () => {
      expect(formatTimeOfYear(['Unknown'])).toBe('Unknown');
    });
  });

  describe('formatList', () => {
    it('joins array elements and sanitizes', () => {
      expect(formatList(['pizza', 'burger'])).toBe('pizza, burger');
    });

    it('returns fallback if array is empty', () => {
      expect(formatList([], 'Default fallback')).toBe('Default fallback');
    });

    it('returns fallback if array is undefined', () => {
      expect(formatList(undefined)).toBe('None specified');
    });
  });

  describe('sanitizePromptInput', () => {
    it('removes curly braces and brackets', () => {
      expect(sanitizePromptInput('{hello} [world] | test')).toBe('hello world test');
    });

    it('replaces angle brackets', () => {
      expect(sanitizePromptInput('<script>alert()</script>')).toBe('&lt;script&gt;alert()&lt;/script&gt;');
    });

    it('slices input to maxLength', () => {
      expect(sanitizePromptInput('1234567890', 5)).toBe('12345');
    });

    it('removes newlines', () => {
      expect(sanitizePromptInput('hello\nworld')).toBe('hello world');
    });
  });

  describe('enforcePostMethod', () => {
    let mockRes: ApiResponse;

    beforeEach(() => {
      mockRes = {
        statusCode: 200,
        setHeader: vi.fn(),
        end: vi.fn(),
      };
    });

    it('handles OPTIONS method', () => {
      const req: ApiRequest = { method: 'OPTIONS' };
      const result = enforcePostMethod(req, mockRes);
      expect(result).toBe(false);
      expect(mockRes.statusCode).toBe(204);
      expect(mockRes.end).toHaveBeenCalled();
    });

    it('handles GET method', () => {
      const req: ApiRequest = { method: 'GET' };
      const result = enforcePostMethod(req, mockRes);
      expect(result).toBe(false);
      expect(mockRes.statusCode).toBe(405);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Allow', 'POST, OPTIONS');
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Method not allowed' }));
    });

    it('allows POST method', () => {
      const req: ApiRequest = { method: 'POST' };
      const result = enforcePostMethod(req, mockRes);
      expect(result).toBe(true);
    });
  });

  describe('handleApiError', () => {
    let mockRes: ApiResponse;

    beforeEach(() => {
      mockRes = {
        statusCode: 200,
        setHeader: vi.fn(),
        end: vi.fn(),
      };
    });

    it('handles RequestValidationError', () => {
      const err = new Error('Invalid input');
      err.name = 'RequestValidationError';
      handleApiError(mockRes, err);
      expect(mockRes.statusCode).toBe(400);
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Invalid input' }));
    });

    it('handles RequestBodyTooLargeError', () => {
      const err = new Error('Too large');
      err.name = 'RequestBodyTooLargeError';
      handleApiError(mockRes, err);
      expect(mockRes.statusCode).toBe(413);
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Too large' }));
    });

    it('handles rate limit errors based on message', () => {
      const err = new Error('Too many requests (rate limit exceeded)');
      handleApiError(mockRes, err);
      expect(mockRes.statusCode).toBe(429);
      expect(mockRes.setHeader).toHaveBeenCalledWith('Retry-After', '10');
      expect(mockRes.end).toHaveBeenCalledWith(
        JSON.stringify({ error: 'Our AI is currently busy. Please wait a moment and try again!' })
      );
    });

    it('handles unknown errors', () => {
      const err = new Error('Something exploded');
      handleApiError(mockRes, err);
      expect(mockRes.statusCode).toBe(500);
      expect(mockRes.end).toHaveBeenCalledWith(JSON.stringify({ error: 'Server error' }));
    });
  });
});
