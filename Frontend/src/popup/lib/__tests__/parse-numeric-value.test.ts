import { describe, it, expect } from 'vitest'
import { parseNumericValue } from '../parse-numeric-value'

describe('parseNumericValue', () => {
  it('parses a basic integer string', () => {
    expect(parseNumericValue('100')).toBe(100)
  })

  it('parses zero string', () => {
    expect(parseNumericValue('0')).toBe(0)
  })

  it('parses a decimal string', () => {
    expect(parseNumericValue('3.14')).toBe(3.14)
  })

  it('parses a negative integer string', () => {
    expect(parseNumericValue('-50')).toBe(-50)
  })

  it('parses a negative decimal string', () => {
    expect(parseNumericValue('-3.14')).toBe(-3.14)
  })

  it('strips dollar sign', () => {
    expect(parseNumericValue('$100')).toBe(100)
  })

  it('strips euro sign and trailing zeros', () => {
    expect(parseNumericValue('€50.00')).toBe(50)
  })

  it('strips comma thousands separator', () => {
    expect(parseNumericValue('1,000')).toBe(1000)
  })

  it('strips comma with decimal', () => {
    expect(parseNumericValue('1,234.56')).toBe(1234.56)
  })

  it('returns 0 for empty string', () => {
    expect(parseNumericValue('')).toBe(0)
  })

  it('returns 0 for non-numeric string', () => {
    expect(parseNumericValue('abc')).toBe(0)
  })

  it('strips "e" from scientific notation — known edge case (1e3 → 13, not 1000)', () => {
    expect(parseNumericValue('1e3')).toBe(13)
  })

  it('parses leading-dot decimal', () => {
    expect(parseNumericValue('.5')).toBe(0.5)
  })

  it('passes through an integer number unchanged', () => {
    expect(parseNumericValue(42)).toBe(42)
  })

  it('passes through a decimal number unchanged', () => {
    expect(parseNumericValue(3.14)).toBe(3.14)
  })

  it('returns 0 for boolean input', () => {
    expect(parseNumericValue(true)).toBe(0)
  })

  it('returns 0 for null', () => {
    expect(parseNumericValue(null)).toBe(0)
  })

  it('returns 0 for undefined', () => {
    expect(parseNumericValue(undefined)).toBe(0)
  })
})
