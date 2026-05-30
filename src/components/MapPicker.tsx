import { useEffect, useRef, useState } from 'react';
import { X, MapPin, Check } from 'lucide-react';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface Props {
  onSelect: (address: string) => void;
  onClose: () => void;
}

// Load Google Maps JS SDK once
let sdkState: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
const sdkCallbacks: Array<(ok: boolean) => void> = [];

function loadSDK(key: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (sdkState === 'ready') { resolve(true); return; }
    if (sdkState === 'error') { resolve(false); return; }
    sdkCallbacks.push(resolve);
    if (sdkState === 'loading') return;
    sdkState = 'loading';

    (window as any).__googleMapsReady = () => {
      sdkState = 'ready';
      sdkCallbacks.forEach(cb => cb(true));
      sdkCallbacks.length = 0;
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&v=weekly&libraries=places,marker&language=vi&region=VN&callback=__googleMapsReady`;
    script.async = true;
    script.onerror = () => {
      sdkState = 'error';
      sdkCallbacks.forEach(cb => cb(false));
      sdkCallbacks.length = 0;
    };
    document.head.appendChild(script);
  });
}

export default function MapPicker({ onSelect, onClose }: Props) {
  const mapDivRef     = useRef<HTMLDivElement>(null);
  const pacDivRef     = useRef<HTMLDivElement>(null);
  const mapRef        = useRef<any>(null);
  const markerRef     = useRef<any>(null);
  const geocoderRef   = useRef<any>(null);

  const [selectedAddress, setSelectedAddress] = useState('');
  const [sdkError, setSdkError]               = useState(false);

  useEffect(() => {
    if (!API_KEY) { setSdkError(true); return; }

    loadSDK(API_KEY).then(async (ok) => {
      if (!ok || !mapDivRef.current) { setSdkError(true); return; }

      const google = (window as any).google;

      // Init map centered on Vietnam
      const map = new google.maps.Map(mapDivRef.current, {
        center: { lat: 16.0, lng: 106.0 },
        zoom: 6,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      mapRef.current = map;
      geocoderRef.current = new google.maps.Geocoder();

      // New PlaceAutocompleteElement (replaces deprecated Autocomplete)
      try {
        const { PlaceAutocompleteElement } = await google.maps.importLibrary('places') as any;
        const pac = new PlaceAutocompleteElement({ language: 'vi', region: 'VN' });
        pac.style.width = '100%';
        pac.style.height = '100%';
        pac.style.border = 'none';
        pac.style.outline = 'none';
        pac.style.background = 'transparent';
        pac.style.fontSize = '14px';
        if (pacDivRef.current) pacDivRef.current.appendChild(pac);

        pac.addEventListener('gmp-placeselect', async (e: any) => {
          const place = e.place;
          await place.fetchFields({ fields: ['displayName', 'formattedAddress', 'location'] });
          const addr = place.formattedAddress || place.displayName || '';
          setSelectedAddress(addr);
          if (place.location) {
            placeMarker(map, place.location);
            map.setCenter(place.location);
            map.setZoom(16);
          }
        });
      } catch {
        setSdkError(true);
      }

      // Click on map → reverse geocode
      map.addListener('click', (e: any) => {
        placeMarker(map, e.latLng);
        geocoderRef.current.geocode({ location: e.latLng }, (results: any[], status: string) => {
          if (status === 'OK' && results[0]) {
            setSelectedAddress(results[0].formatted_address);
          } else {
            setSelectedAddress(`${e.latLng.lat().toFixed(6)}, ${e.latLng.lng().toFixed(6)}`);
          }
        });
      });
    });

    return () => {
      if (markerRef.current) markerRef.current.setMap(null);
    };
  }, []);

  function placeMarker(map: any, location: any) {
    const google = (window as any).google;
    if (markerRef.current) markerRef.current.setMap(null);
    markerRef.current = new google.maps.Marker({ position: location, map, animation: google.maps.Animation.DROP });
  }

  // Fallback: no API key
  if (!API_KEY || sdkError) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white gap-4 px-8 text-center">
        <MapPin size={40} className="text-slate-200" />
        <p className="text-slate-500 text-sm">Chưa cấu hình Google Maps API key.</p>
        <p className="text-slate-400 text-xs">Thêm <code className="bg-slate-100 px-1 rounded">VITE_GOOGLE_MAPS_API_KEY</code> vào <code className="bg-slate-100 px-1 rounded">.env.local</code></p>
        <button onClick={onClose} className="mt-2 px-5 py-2 bg-slate-100 rounded-xl text-sm text-slate-600">Đóng</button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white">

      {/* Header + Search */}
      <div className="flex items-center gap-2 px-4 pt-safe-4 pb-3 bg-white shadow-sm z-10">
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 transition-colors flex-shrink-0"
        >
          <X size={18} />
        </button>
        <div
          ref={pacDivRef}
          className="flex-1 bg-slate-100 rounded-xl px-4 py-2.5 text-sm border border-transparent focus-within:bg-white focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-400/30 transition-all overflow-hidden"
          style={{ minHeight: '40px' }}
        />
      </div>

      {/* Google Map */}
      <div ref={mapDivRef} className="flex-1" />

      {/* Footer */}
      <div className="px-4 py-3 pb-safe-5 bg-white border-t border-slate-100 min-h-[72px] flex items-center">
        {selectedAddress ? (
          <div className="flex items-center gap-3 w-full">
            <MapPin size={16} className="flex-shrink-0 text-blue-500" />
            <p className="flex-1 text-sm text-slate-700 leading-snug line-clamp-2">{selectedAddress}</p>
            <button
              onClick={() => onSelect(selectedAddress)}
              className="flex items-center gap-1.5 bg-blue-600 text-white text-sm font-semibold px-4 py-2.5 rounded-xl flex-shrink-0 active:bg-blue-700 transition-colors"
            >
              <Check size={15} />
              Chọn
            </button>
          </div>
        ) : (
          <p className="w-full text-center text-sm text-slate-400">
            Tìm kiếm hoặc nhấn vào bản đồ để chọn địa điểm
          </p>
        )}
      </div>
    </div>
  );
}
