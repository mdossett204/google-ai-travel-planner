import { describe, it, expect } from 'vitest';
import {
  readJsonBody,
  InvalidJsonBodyError,
  RequestBodyTooLargeError
} from '../../utils/http.js';

describe('readJsonBody', () => {
  it('parses valid JSON from req.body string', async () => {
    const req = {
      body: JSON.stringify({ key: 'value' })
    };
    const result = await readJsonBody(req);
    expect(result).toEqual({ key: 'value' });
  });

  it('returns req.body directly if it is an object', async () => {
    const req = {
      body: { key: 'value' }
    };
    const result = await readJsonBody(req);
    expect(result).toEqual({ key: 'value' });
  });

  it('throws RequestBodyTooLargeError if content-length is too high', async () => {
    const req = {
      headers: {
        'content-length': '999999999'
      }
    };
    await expect(readJsonBody(req)).rejects.toThrow(RequestBodyTooLargeError);
  });

  it('throws InvalidJsonBodyError if string body is empty', async () => {
    const req = {
      body: '   '
    };
    await expect(readJsonBody(req)).rejects.toThrow(InvalidJsonBodyError);
  });

  it('throws InvalidJsonBodyError if string body is invalid JSON', async () => {
    const req = {
      body: '{ invalid json }'
    };
    await expect(readJsonBody(req)).rejects.toThrow(InvalidJsonBodyError);
  });

  it('reads JSON from stream (async iterable)', async () => {
    const req = {
      headers: {},
      async *[Symbol.asyncIterator]() {
        yield '{"key"';
        yield ':"value"}';
      }
    };
    const result = await readJsonBody(req);
    expect(result).toEqual({ key: 'value' });
  });
});
