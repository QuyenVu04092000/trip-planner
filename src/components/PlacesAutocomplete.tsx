import { useState, useEffect, useRef, useCallback } from 'react';
import { MapPin, Loader2, X } from 'lucide-react';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;

interface Suggestion {
  placeId: string;
  text: string;        // main display text
  secondary: string;   // secondary (city, country)
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

async function fetchSuggestions(input: string): Promise<Suggestion[]> {
  if (!API_KEY || input.trim().length < 2) return [];

  const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': API_KEY,
    },
    body: JSON.stringify({
      input,
      languageCode: 'vi',
    }),
  });

  if (!res.ok) return [];

  const json = await res.json();
  const suggestions: Suggestion[] = (json.suggestions ?? []).map((s: any) => {
    const pred = s.placePrediction;
    return {
      placeId: pred?.placeId ?? '',
      text: pred?.structuredFormat?.mainText?.text ?? pred?.text?.text ?? '',
      secondary: pred?.structuredFormat?.secondaryText?.text ?? '',
    };
  });

  return suggestions;
}

export default function PlacesAutocomplete({ value, onChange, placeholder, className }: Props) {
  const [query, setQuery] = useState(value);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Sync external value → local query (e.g. when form resets)
  useEffect(() => {
    setQuery(value);
  }, [value]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const search = useCallback((input: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!input.trim() || input.trim().length < 2) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await fetchSuggestions(input);
        setSuggestions(results);
        setOpen(results.length > 0);
        setActiveIdx(-1);
      } finally {
        setLoading(false);
      }
    }, 350);
  }, []);

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value;
    setQuery(v);
    onChange(v); // keep parent form in sync while typing
    search(v);
  }

  function selectSuggestion(s: Suggestion) {
    const fullAddress = s.secondary ? `${s.text}, ${s.secondary}` : s.text;
    setQuery(fullAddress);
    onChange(fullAddress);
    setSuggestions([]);
    setOpen(false);
    setActiveIdx(-1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      selectSuggestion(suggestions[activeIdx]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleClear() {
    setQuery('');
    onChange('');
    setSuggestions([]);
    setOpen(false);
    inputRef.current?.focus();
  }

  // Fallback: if no API key, render plain input
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
    <div ref={containerRef} className="relative">
      <div className="relative">
        <MapPin
          size={14}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 pointer-events-none"
        />
        <input
          ref={inputRef}
          className={`${className ?? ''} pl-8 pr-8`}
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {/* Right icon: spinner or clear */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center">
          {loading
            ? <Loader2 size={13} className="text-slate-300 animate-spin" />
            : query
              ? <button type="button" onClick={handleClear} className="text-slate-300 hover:text-slate-500 transition-colors">
                  <X size={13} />
                </button>
              : null
          }
        </div>
      </div>

      {/* Dropdown */}
      {open && suggestions.length > 0 && (
        <ul className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
          {suggestions.map((s, i) => (
            <li
              key={s.placeId || i}
              onMouseDown={() => selectSuggestion(s)}
              className={`flex items-start gap-2.5 px-3.5 py-2.5 cursor-pointer transition-colors ${
                i === activeIdx ? 'bg-blue-50' : 'hover:bg-slate-50'
              }`}
            >
              <MapPin size={13} className="flex-shrink-0 text-slate-300 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm text-slate-700 font-medium leading-snug truncate">{s.text}</p>
                {s.secondary && (
                  <p className="text-xs text-slate-400 truncate">{s.secondary}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
