import { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import MapPicker from './MapPicker';

interface Props {
  value: string;
  onChange: (value: string, coords?: { lat: number; lon: number }) => void;
  placeholder?: string;
  className?: string;
}

export default function PlacesAutocomplete({ value, onChange, placeholder, className }: Props) {
  const [mapOpen, setMapOpen] = useState(false);

  function handleSelect(address: string, lat?: number, lon?: number) {
    onChange(address, lat != null && lon != null ? { lat, lon } : undefined);
    setMapOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  return (
    <>
      {/* Address field — tap to open map */}
      <div
        onClick={() => setMapOpen(true)}
        className={`${className ?? ''} flex items-center gap-2 cursor-pointer`}
      >
        <MapPin size={14} className="flex-shrink-0 text-slate-300" />
        {value ? (
          <span className="flex-1 text-slate-700 truncate text-sm">{value}</span>
        ) : (
          <span className="flex-1 text-slate-300 text-sm">{placeholder ?? 'Tìm địa điểm...'}</span>
        )}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 text-slate-300 hover:text-slate-500 transition-colors"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Map picker modal */}
      {mapOpen && (
        <MapPicker
          onSelect={handleSelect}
          onClose={() => setMapOpen(false)}
          initialValue={value}
        />
      )}
    </>
  );
}
