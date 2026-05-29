import { useEffect, useRef } from 'react';
import { MapPin } from 'lucide-react';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

// Load Google Maps JS SDK once
let sdkLoaded = false;
let sdkLoading = false;
const sdkCallbacks: (() => void)[] = [];

function loadGoogleMapsSDK(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    if (sdkLoaded) { resolve(); return; }
    sdkCallbacks.push(resolve);
    if (sdkLoading) return;
    sdkLoading = true;

    (window as any).__googleMapsInit = () => {
      sdkLoaded = true;
      sdkCallbacks.forEach(cb => cb());
      sdkCallbacks.length = 0;
    };

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=vi&callback=__googleMapsInit`;
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

export default function PlacesAutocomplete({ value, onChange, placeholder, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const autocompleteRef = useRef<any>(null);

  useEffect(() => {
    if (!API_KEY || !inputRef.current) return;

    loadGoogleMapsSDK(API_KEY).then(() => {
      if (!inputRef.current) return;
      const google = (window as any).google;
      if (!google?.maps?.places) return;

      autocompleteRef.current = new google.maps.places.Autocomplete(inputRef.current, {
        language: 'vi',
        fields: ['formatted_address', 'name', 'geometry'],
      });

      autocompleteRef.current.addListener('place_changed', () => {
        const place = autocompleteRef.current.getPlace();
        const address = place.formatted_address || place.name || '';
        onChange(address);
      });
    });

    return () => {
      if (autocompleteRef.current) {
        const google = (window as any).google;
        google?.maps?.event?.clearInstanceListeners?.(autocompleteRef.current);
      }
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // No API key → plain input
  if (!API_KEY) {
    return (
      <input
        className={className}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
      />
    );
  }

  return (
    <div className="relative">
      <MapPin
        size={14}
        className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none z-10"
      />
      <input
        ref={inputRef}
        className={`${className ?? ''} pl-8`}
        defaultValue={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}
