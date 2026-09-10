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

  /**
   * The known city closest to a point — used when the location pin is dragged /
   * clicked on the map so the city input reflects the new position.
   */
  nearestCity(lat: number, lng: number): RoCity {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new NotFoundException('Invalid coordinates');
    }
    let best = RO_CITIES[0] as RoCity;
    let bestD = Number.POSITIVE_INFINITY;
    for (const c of RO_CITIES) {
      const dLat = c.lat - lat;
      const dLng = (c.lng - lng) * Math.cos((lat * Math.PI) / 180);
      const d = dLat * dLat + dLng * dLng; // squared, monotonic — no sqrt needed
      if (d < bestD) {
        bestD = d;
        best = c as RoCity;
      }
    }
    return best;
  }
}
