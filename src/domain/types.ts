export type LngLat = { lng: number; lat: number };

export type MatchProfile = "walking" | "cycling" | "driving";

export interface GenerateRouteInput {
  points: LngLat[];           // brukerens rå punkter
  profile: MatchProfile;      // map matching profil
  paceSecPerKm: number;       // 300 = 5:00/km
  startTimeISO?: string;      // default = now
  addPauses?: boolean;        // legg til realistiske pauser
  pauseEveryKm?: number;      // f.eks. 5 (hver 5. km)
  pauseSeconds?: number;      // f.eks. 20 sek
  jitterSecondsPerKm?: number;// variasjon, f.eks. 5
}

export type MatchedPoint = LngLat & {
  distanceOnRouteM?: number; // kumulativ distanse fra start (m)
  elevationM?: number | null;
  timeISO?: string;          // ISO timestamp per punkt
};