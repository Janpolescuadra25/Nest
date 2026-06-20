import { describe, expect, it } from 'vitest';
import { jaroWinkler, tokenOverlap, fuzzyMatch, FUZZY_MATCH_THRESHOLD, FUZZY_LOW_CONFIDENCE_THRESHOLD } from '../fuzzy-matcher';

describe('fuzzy-matcher', () => {

  describe('Constants', () => {
    it('FUZZY_MATCH_THRESHOLD should be 0.85', () => {
      expect(FUZZY_MATCH_THRESHOLD).toBe(0.85);
    });
    it('FUZZY_LOW_CONFIDENCE_THRESHOLD should be 0.92', () => {
      expect(FUZZY_LOW_CONFIDENCE_THRESHOLD).toBe(0.92);
    });
  });

  describe('jaroWinkler()', () => {
    it('returns 1.0 for identical strings', () => {
      expect(jaroWinkler('hello', 'hello')).toBe(1.0);
    });
    it('returns 1.0 for both empty strings', () => {
      expect(jaroWinkler('', '')).toBe(1.0);
    });
    it('returns 0 when one string is empty', () => {
      expect(jaroWinkler('', 'hello')).toBe(0);
      expect(jaroWinkler('hello', '')).toBe(0);
    });
    it('returns 1.0 for single char match', () => {
      expect(jaroWinkler('a', 'a')).toBe(1.0);
    });
    it('returns 0 for single char mismatch', () => {
      expect(jaroWinkler('a', 'b')).toBe(0);
    });
    it('returns high score for transposition (MARTHA/MARHTA)', () => {
      const score = jaroWinkler('MARTHA', 'MARHTA');
      expect(score).toBeGreaterThan(0.94);
    });
    it('returns 0 for completely different strings', () => {
      expect(jaroWinkler('abc', 'xyz')).toBe(0);
    });
    it('returns medium score for partial match (CRATE/TRACE)', () => {
      const score = jaroWinkler('CRATE', 'TRACE');
      expect(score).toBeGreaterThan(0.7);
      expect(score).toBeLessThan(0.8);
    });
    it('is case-sensitive (Hello vs hello)', () => {
      const score = jaroWinkler('Hello', 'hello');
      expect(score).toBeLessThan(1.0);
    });
  });

  describe('tokenOverlap()', () => {
    it('returns 1.0 for same tokens in different order', () => {
      expect(tokenOverlap('Coca Cola', 'Cola Coca')).toBe(1.0);
    });
    it('returns 0.5 for partial overlap', () => {
      expect(tokenOverlap('Coca Cola 2L', 'Pepsi Cola')).toBe(0.5);
    });
    it('returns 0 for no overlap', () => {
      expect(tokenOverlap('Apple', 'Orange')).toBe(0);
    });
    it('returns 0 when one string is empty', () => {
      expect(tokenOverlap('', 'hello')).toBe(0);
    });
    it('returns 0 when both strings are empty', () => {
      expect(tokenOverlap('', '')).toBe(0);
    });
    it('handles punctuation splitting (hyphen vs space)', () => {
      expect(tokenOverlap('Coca-Cola', 'Coca Cola')).toBe(1.0);
    });
    it('is case-insensitive', () => {
      expect(tokenOverlap('COCA', 'coca')).toBe(1.0);
    });
  });

  describe('fuzzyMatch()', () => {
    it('returns exact match with score 1.0', () => {
      const result = fuzzyMatch('hello', ['hello', 'world']);
      expect(result).not.toBeNull();
      expect(result!.index).toBe(0);
      expect(result!.score).toBe(1.0);
    });
    it('returns null when no token overlap', () => {
      const result = fuzzyMatch('apple', ['zebra', 'giraffe']);
      expect(result).toBeNull();
    });
    it('returns null for empty candidates array', () => {
      const result = fuzzyMatch('test', []);
      expect(result).toBeNull();
    });
    it('returns null for empty input', () => {
      const result = fuzzyMatch('', ['hello']);
      expect(result).toBeNull();
    });
    it('picks best match among multiple candidates', () => {
      const result = fuzzyMatch('Cola', ['Pepsi Cola', 'Cola']);
      expect(result).not.toBeNull();
      expect(result!.index).toBe(1);
    });
    it('uses default threshold of 0.85', () => {
      const result = fuzzyMatch('test', ['test']);
      expect(result).not.toBeNull();
      expect(result!.score).toBe(1.0);
    });
    it('returns null when best score is below threshold', () => {
      const result = fuzzyMatch('hello', ['hello world'], 0.99);
      expect(result).toBeNull();
    });
  });

});
