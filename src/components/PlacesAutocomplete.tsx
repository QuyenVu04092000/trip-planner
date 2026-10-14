import { useState } from 'react';
import { MapPin, X } from 'lucide-react';
import MapPicker from './MapPicker';

interface Props {
  value: string;
  onChange: (value: string, coords?: { lat: number; lon: number }) => void;
  // Toạ độ đã lưu của `value` (nếu có) → MapPicker ghim đúng chỗ khi mở lại.
  lat?: number | null;
  lon?: number | null;
  placeholder?: string;
  className?: string;
}

export default function PlacesAutocomplete({ value, onChange, lat, lon, placeholder, className }: Props) {
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
        <MapPin size={14} className="flex-shrink-0 text-dune" />
        {value ? (
          <span className="flex-1 text-ink truncate text-sm">{value}</span>
        ) : (
          <span className="flex-1 text-dune text-sm">{placeholder ?? 'Tìm địa điểm...'}</span>
        )}
        {value && (
          <button
            type="button"
            onClick={handleClear}
            className="flex-shrink-0 text-dune hover:text-stone transition-colors"
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
          initialCoords={value && lat != null && lon != null ? { lat, lon } : null}
        />
      )}
    </>
  );
}
