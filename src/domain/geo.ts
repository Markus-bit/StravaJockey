const R = 6371000; // jordradius i meter

export function toRad(d: number) { return d * Math.PI / 180; }

export function haversine(a: {lat:number;lng:number}, b:{lat:number;lng:number}): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat/2)**2 + Math.sin(dLng/2)**2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function accumulateDistances(points: {lat:number;lng:number}[]): number[] {
  let acc = 0;
  const out = [0];
  for (let i=1;i<points.length;i++){
    acc += haversine(points[i-1], points[i]);
    out.push(acc);
  }
  return out;
}