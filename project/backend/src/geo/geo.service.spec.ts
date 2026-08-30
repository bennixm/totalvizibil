import { NotFoundException } from '@nestjs/common';
import { GeoService } from './geo.service';

describe('GeoService', () => {
  const geo = new GeoService();

  it('matches accent-insensitively and prefers prefix hits', () => {
    const results = geo.searchCities('timis');
    expect(results[0].name).toBe('Timișoara');
  });

  it('finds "Cluj-Napoca" from "cluj"', () => {
    expect(geo.searchCities('cluj').map((c) => c.name)).toContain('Cluj-Napoca');
  });

  it('substring match still works ("mures" -> Târgu Mureș)', () => {
    expect(geo.searchCities('mures').map((c) => c.name)).toContain('Târgu Mureș');
  });

  it('empty query returns a capped default list', () => {
    const results = geo.searchCities('');
    expect(results.length).toBeGreaterThan(0);
    expect(results.length).toBeLessThanOrEqual(12);
    expect(results[0].name).toBe('București');
  });

  it('respects the limit', () => {
    expect(geo.searchCities('a', 3).length).toBeLessThanOrEqual(3);
  });

  it('resolveCity returns coordinates for a known city', () => {
    const city = geo.resolveCity('brasov');
    expect(city.county).toBe('Brașov');
    expect(city.lat).toBeCloseTo(45.64, 1);
  });

  it('resolveCity throws for an unknown city', () => {
    expect(() => geo.resolveCity('Atlantis')).toThrow(NotFoundException);
  });
});
