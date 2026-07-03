// Dự báo thời tiết theo ngày qua Open-Meteo (miễn phí, KHÔNG cần key).
// Chỉ có dự báo ~16 ngày tới; ngày xa hơn sẽ không có dữ liệu.

export interface DayWeather {
  code: number;
  tMax: number;
  tMin: number;
}

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// Geocode tên điểm đến → toạ độ (Mapbox).
export async function geocodePlace(q: string): Promise<{ lat: number; lon: number } | null> {
  if (!q) return null;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(q)}.json?access_token=${MAPBOX_TOKEN}&language=vi&country=VN&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const f = data.features?.[0];
    return f ? { lon: f.center[0], lat: f.center[1] } : null;
  } catch {
    return null;
  }
}

// Lấy dự báo ngày → map { "yyyy-MM-dd": DayWeather }
export async function fetchWeather(lat: number, lon: number): Promise<Record<string, DayWeather>> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=16`;
  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    const d = await res.json();
    const days: string[] = d.daily?.time ?? [];
    const out: Record<string, DayWeather> = {};
    days.forEach((day, i) => {
      out[day] = {
        code: d.daily.weather_code[i],
        tMax: Math.round(d.daily.temperature_2m_max[i]),
        tMin: Math.round(d.daily.temperature_2m_min[i]),
      };
    });
    return out;
  } catch {
    return {};
  }
}

// Mã WMO → emoji + mô tả ngắn (gom nhóm cho gọn).
export function weatherInfo(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'Nắng' };
  if (code <= 2) return { emoji: '🌤️', label: 'Ít mây' };
  if (code === 3) return { emoji: '☁️', label: 'Nhiều mây' };
  if (code <= 48) return { emoji: '🌫️', label: 'Sương mù' };
  if (code <= 57) return { emoji: '🌦️', label: 'Mưa phùn' };
  if (code <= 67) return { emoji: '🌧️', label: 'Mưa' };
  if (code <= 77) return { emoji: '🌨️', label: 'Tuyết' };
  if (code <= 82) return { emoji: '🌧️', label: 'Mưa rào' };
  if (code <= 86) return { emoji: '🌨️', label: 'Mưa tuyết' };
  if (code <= 99) return { emoji: '⛈️', label: 'Giông' };
  return { emoji: '🌡️', label: '' };
}
