import { haversine } from "../domain/geo";
import type { LngLat } from "../domain/types";

// lineær interpolasjon i WGS84 (nok for korte segmenter)
function lerp(a:number,b:number,t:number){ return a + (b-a)*t; }

export function densifyLine(points: LngLat[], spacingM = 25): LngLat[] {
  if (points.length < 2) return points;
  const out: LngLat[] = [points[0]];
  for (let i=1;i<points.length;i++){
    const a = points[i-1], b = points[i];
    const d = haversine(a,b);
    if (d <= spacingM) { out.push(b); continue; }
    const n = Math.floor(d/spacingM);
    for (let k=1;k<=n;k++){
      const t = (k*spacingM)/d;
      out.push({ lng: lerp(a.lng,b.lng,t), lat: lerp(a.lat,b.lat,t) });
    }
    out.push(b);
  }
  return out;
}