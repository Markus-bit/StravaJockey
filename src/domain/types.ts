export type LngLat = { lng: number; lat: number };

// Routing profile: Run uses walking routes, Bike uses cycling routes
export type MatchProfile = "walking" | "cycling";

export type MatchedPoint = LngLat & {
  distanceOnRouteM?: number; // cumulative distance from the start (m)
  elevationM?: number | null;
  timeISO?: string;          // ISO timestamp of the point
  heartRateBpm?: number;     // heart rate (beats per minute)
};
