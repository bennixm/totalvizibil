import { Injectable, NotFoundException } from '@nestjs/common';
import { RO_CITIES, RoCity } from './ro-cities';

/** Strip diacritics + lowercase for accent-insensitive matching. */
function fold(s: string): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining diacritical marks
    .toLowerCase()
    .trim();
}

const FOLDED: { city: RoCity; folded: string }[] = RO_CITIES.map((city) => ({
  city,
  folded: fold(city.name),
}));

@Injectable()
export class GeoService {
  /** Type-ahead city search. Empty query returns the largest cities. */
  searchCities(query: string, limit = 12): RoCity[] {
    const q = fold(query ?? '');
    if (!q) return RO_CITIES.slice(0, limit) as RoCity[];

    const starts: RoCity[] = [];
    const contains: RoCity[] = [];
    for (const { city, folded } of FOLDED) {
      if (folded.startsWith(q)) starts.push(city);
      else if (folded.includes(q)) contains.push(city);
    }
    return [...starts, ...contains].slice(0, limit);
  }

  /** Resolve a known city by exact (accent-insensitive) name. */
  resolveCity(name: string): RoCity {
    const q = fold(name ?? '');
    const hit = FOLDED.find((c) => c.folded === q);
    if (!hit) throw new NotFoundException('Unknown city');
    return hit.city;
  }
}
