/**
 * Canonical list of Romanian cities with coordinates — static reference data
 * for the location step (M2). Not seeded: it does not change and needs no
 * relations. If arbitrary places are ever needed, a geocoder (Nominatim) can be
 * added behind the same `GeoService.searchCities` API without touching callers.
 *
 * Coordinates are city-centre, ~4 decimal places. `county` uses the Romanian
 * județ name.
 */
export interface RoCity {
  name: string;
  county: string;
  lat: number;
  lng: number;
}

export const RO_CITIES: readonly RoCity[] = [
  { name: 'București', county: 'București', lat: 44.4268, lng: 26.1025 },
  { name: 'Cluj-Napoca', county: 'Cluj', lat: 46.7712, lng: 23.6236 },
  { name: 'Timișoara', county: 'Timiș', lat: 45.7489, lng: 21.2087 },
  { name: 'Iași', county: 'Iași', lat: 47.1585, lng: 27.6014 },
  { name: 'Constanța', county: 'Constanța', lat: 44.1598, lng: 28.6348 },
  { name: 'Craiova', county: 'Dolj', lat: 44.3302, lng: 23.7949 },
  { name: 'Brașov', county: 'Brașov', lat: 45.6427, lng: 25.5887 },
  { name: 'Galați', county: 'Galați', lat: 45.4353, lng: 28.008 },
  { name: 'Ploiești', county: 'Prahova', lat: 44.9469, lng: 26.0367 },
  { name: 'Oradea', county: 'Bihor', lat: 47.0722, lng: 21.9217 },
  { name: 'Brăila', county: 'Brăila', lat: 45.2692, lng: 27.9575 },
  { name: 'Arad', county: 'Arad', lat: 46.1866, lng: 21.3123 },
  { name: 'Pitești', county: 'Argeș', lat: 44.8565, lng: 24.8692 },
  { name: 'Sibiu', county: 'Sibiu', lat: 45.7983, lng: 24.1256 },
  { name: 'Bacău', county: 'Bacău', lat: 46.5671, lng: 26.9136 },
  { name: 'Târgu Mureș', county: 'Mureș', lat: 46.5425, lng: 24.5579 },
  { name: 'Baia Mare', county: 'Maramureș', lat: 47.6573, lng: 23.5681 },
  { name: 'Buzău', county: 'Buzău', lat: 45.1489, lng: 26.8244 },
  { name: 'Botoșani', county: 'Botoșani', lat: 47.7409, lng: 26.6697 },
  { name: 'Satu Mare', county: 'Satu Mare', lat: 47.792, lng: 22.8856 },
  { name: 'Râmnicu Vâlcea', county: 'Vâlcea', lat: 45.0997, lng: 24.3693 },
  { name: 'Drobeta-Turnu Severin', county: 'Mehedinți', lat: 44.6369, lng: 22.6597 },
  { name: 'Suceava', county: 'Suceava', lat: 47.6514, lng: 26.2556 },
  { name: 'Piatra Neamț', county: 'Neamț', lat: 46.9275, lng: 26.3708 },
  { name: 'Târgoviște', county: 'Dâmbovița', lat: 44.9247, lng: 25.4567 },
  { name: 'Focșani', county: 'Vrancea', lat: 45.6966, lng: 27.1863 },
  { name: 'Bistrița', county: 'Bistrița-Năsăud', lat: 47.1359, lng: 24.4914 },
  { name: 'Târgu Jiu', county: 'Gorj', lat: 45.0357, lng: 23.2745 },
  { name: 'Tulcea', county: 'Tulcea', lat: 45.1667, lng: 28.8 },
  { name: 'Reșița', county: 'Caraș-Severin', lat: 45.2971, lng: 21.8894 },
  { name: 'Slatina', county: 'Olt', lat: 44.4308, lng: 24.3707 },
  { name: 'Călărași', county: 'Călărași', lat: 44.2058, lng: 27.33 },
  { name: 'Alba Iulia', county: 'Alba', lat: 46.0733, lng: 23.5805 },
  { name: 'Giurgiu', county: 'Giurgiu', lat: 43.9037, lng: 25.9699 },
  { name: 'Deva', county: 'Hunedoara', lat: 45.883, lng: 22.9 },
  { name: 'Hunedoara', county: 'Hunedoara', lat: 45.7681, lng: 22.9086 },
  { name: 'Zalău', county: 'Sălaj', lat: 47.1911, lng: 23.0576 },
  { name: 'Sfântu Gheorghe', county: 'Covasna', lat: 45.8667, lng: 25.7833 },
  { name: 'Bârlad', county: 'Vaslui', lat: 46.2286, lng: 27.6678 },
  { name: 'Vaslui', county: 'Vaslui', lat: 46.6407, lng: 27.7276 },
  { name: 'Roman', county: 'Neamț', lat: 46.9197, lng: 26.9269 },
  { name: 'Turda', county: 'Cluj', lat: 46.5667, lng: 23.7833 },
  { name: 'Mediaș', county: 'Sibiu', lat: 46.1667, lng: 24.35 },
  { name: 'Slobozia', county: 'Ialomița', lat: 44.5647, lng: 27.3661 },
  { name: 'Alexandria', county: 'Teleorman', lat: 43.9711, lng: 25.3339 },
  { name: 'Miercurea Ciuc', county: 'Harghita', lat: 46.3597, lng: 25.8025 },
  { name: 'Sighetu Marmației', county: 'Maramureș', lat: 47.9281, lng: 23.8869 },
  { name: 'Petroșani', county: 'Hunedoara', lat: 45.4167, lng: 23.3667 },
  { name: 'Mangalia', county: 'Constanța', lat: 43.8167, lng: 28.5833 },
  { name: 'Târnăveni', county: 'Mureș', lat: 46.3333, lng: 24.2833 },
  { name: 'Câmpina', county: 'Prahova', lat: 45.1281, lng: 25.7361 },
  { name: 'Câmpulung', county: 'Argeș', lat: 45.2683, lng: 25.045 },
  { name: 'Caracal', county: 'Olt', lat: 44.1122, lng: 24.3508 },
  { name: 'Făgăraș', county: 'Brașov', lat: 45.8433, lng: 24.9733 },
  { name: 'Sighișoara', county: 'Mureș', lat: 46.2197, lng: 24.7925 },
  { name: 'Curtea de Argeș', county: 'Argeș', lat: 45.1394, lng: 24.6772 },
  { name: 'Lugoj', county: 'Timiș', lat: 45.6889, lng: 21.9033 },
  { name: 'Medgidia', county: 'Constanța', lat: 44.2492, lng: 28.2725 },
  { name: 'Onești', county: 'Bacău', lat: 46.2489, lng: 26.7692 },
  { name: 'Dej', county: 'Cluj', lat: 47.1417, lng: 23.8747 },
  { name: 'Rădăuți', county: 'Suceava', lat: 47.85, lng: 25.9167 },
  { name: 'Năvodari', county: 'Constanța', lat: 44.3194, lng: 28.6122 },
  { name: 'Voluntari', county: 'Ilfov', lat: 44.4925, lng: 26.1858 },
  { name: 'Pantelimon', county: 'Ilfov', lat: 44.4517, lng: 26.2214 },
  { name: 'Otopeni', county: 'Ilfov', lat: 44.55, lng: 26.0667 },
];
