import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import type { Suggestion, SuggestionCategory } from "../types";

mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN as string;

const PIN_COLOR: Record<SuggestionCategory, string> = {
  food: "#ea580c",
  cafe: "#d97706",
  attraction: "#2563eb",
  checkin: "#db2777",
};

interface Props {
  items: Suggestion[];
}

export default function SuggestionsMap({ items }: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);

  useEffect(() => {
    if (!divRef.current || mapRef.current) return;

    const located = items.filter((s) => s.lat != null && s.lon != null);
    const map = new mapboxgl.Map({
      container: divRef.current,
      style: "mapbox://styles/mapbox/streets-v12",
      center: located.length
        ? [located[0].lon as number, located[0].lat as number]
        : [106.0, 16.0],
      zoom: 11,
      language: "vi",
    });
    map.addControl(new mapboxgl.NavigationControl(), "top-right");

    const bounds = new mapboxgl.LngLatBounds();
    for (const s of located) {
      const lon = s.lon as number;
      const lat = s.lat as number;
      const popup = new mapboxgl.Popup({ offset: 24, closeButton: false }).setHTML(
        `<div style="font-weight:600;font-size:13px;margin-bottom:2px">${s.name}</div>
         <div style="font-size:11px;color:#64748b">${s.description ?? ""}</div>`,
      );
      new mapboxgl.Marker({ color: PIN_COLOR[s.category] ?? "#2563eb" })
        .setLngLat([lon, lat])
        .setPopup(popup)
        .addTo(map);
      bounds.extend([lon, lat]);
    }
    if (located.length > 1) {
      map.fitBounds(bounds, { padding: 50, maxZoom: 14, duration: 0 });
    }

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [items]);

  return <div ref={divRef} className="w-full h-full" />;
}
