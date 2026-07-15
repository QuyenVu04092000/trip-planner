import { useState, useEffect } from "react";
import {
  Plus,
  Trash2,
  MapPin,
  CalendarDays,
  Navigation,
  Shuffle,
} from "lucide-react";
import PlacesAutocomplete from "./PlacesAutocomplete";
import type { Activity, BackupAddress } from "../types";
import { optimizeOrder } from "../utils/routeOptimize";
import { geocodePlace, fetchWeather, weatherInfo, type DayWeather } from "../utils/weather";
import { openDirections } from "../utils/maps";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";

// 6 tông đất cho từng ngày — giữ tính năng phân biệt ngày, theo journal palette
const PALETTE = [
  {
    pill: "bg-terra",
    light: "bg-terra-pale/60",
    accent: "text-terra-dark",
    border: "border-terra/25",
    time: "bg-terra-pale text-terra-dark",
    dot: "bg-terra",
    line: "bg-terra-pale",
  },
  {
    pill: "bg-slateblue",
    light: "bg-[#E9EEF1]",
    accent: "text-slateblue",
    border: "border-slateblue/25",
    time: "bg-[#E3EAEE] text-[#334755]",
    dot: "bg-slateblue",
    line: "bg-[#E3EAEE]",
  },
  {
    pill: "bg-moss",
    light: "bg-sage-pale/70",
    accent: "text-sage-dark",
    border: "border-sage/50",
    time: "bg-sage-pale text-sage-dark",
    dot: "bg-moss",
    line: "bg-sage-pale",
  },
  {
    pill: "bg-gold",
    light: "bg-gold-pale/60",
    accent: "text-gold-dark",
    border: "border-gold/30",
    time: "bg-gold-pale text-gold-dark",
    dot: "bg-gold",
    line: "bg-gold-pale",
  },
  {
    pill: "bg-clay",
    light: "bg-clay-pale/70",
    accent: "text-clay-dark",
    border: "border-clay/30",
    time: "bg-clay-pale text-clay-dark",
    dot: "bg-clay",
    line: "bg-clay-pale",
  },
  {
    pill: "bg-plum",
    light: "bg-[#F1EAEF]",
    accent: "text-[#5D3F50]",
    border: "border-plum/30",
    time: "bg-[#EEE5EB] text-[#5D3F50]",
    dot: "bg-plum",
    line: "bg-[#EEE5EB]",
  },
] as const;

type Palette = (typeof PALETTE)[number];
type FormData = Omit<Activity, "id" | "tripId" | "createdAt">;

const BLANK: FormData = {
  date: "",
  time: "",
  activity: "",
  address: "",
  lat: null,
  lon: null,
  backups: [],
  cost: "",
  notes: "",
  position: 0,
};

interface Props {
  activities: Activity[];
  startDate?: string;
  destination?: string;
  destLat?: number | null;
  destLon?: number | null;
  onAdd: (
    fields: Omit<Activity, "id" | "tripId" | "createdAt">,
  ) => Promise<void>;
  onUpdate: (
    id: string,
    fields: Partial<Omit<Activity, "id" | "tripId" | "createdAt">>,
  ) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

// Ảnh bản đồ tĩnh (Mapbox Static Images) với pin ĐÁNH SỐ theo thứ tự hoạt động
// trong ngày → nhìn được tuyến đường tổng thể mà không cần map tương tác.
// Chỉ hiện khi ngày có ≥2 hoạt động có toạ độ.
function dayMapUrl(acts: Activity[]): string | null {
  const located = acts.filter((a) => a.lat != null && a.lon != null).slice(0, 10);
  if (located.length < 2) return null;
  const pins = located
    .map((a, i) => `pin-s-${i + 1}+C4622D(${a.lon},${a.lat})`)
    .join(',');
  return (
    `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${pins}/auto/640x240@2x` +
    `?padding=44&access_token=${MAPBOX_TOKEN}`
  );
}

function isValidDate(d: string) {
  if (!d || d.startsWith("=")) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) || /^\d{2}\/\d{2}\/\d{4}$/.test(d);
}

function fmtDate(d: string): string {
  if (!isValidDate(d)) return "";
  let date: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) date = new Date(d + "T00:00:00");
  else {
    const [dd, mm, yyyy] = d.split("/");
    date = new Date(`${yyyy}-${mm}-${dd}T00:00:00`);
  }
  if (!date || isNaN(date.getTime())) return d;
  return date.toLocaleDateString("vi-VN", {
    weekday: "short",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function normDate(s: string) {
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
    const [d, m, y] = s.split("/");
    return `${y}-${m}-${d}`;
  }
  return s;
}

function nextDefaultDate(activities: Activity[], startDate: string): string {
  const validDates = activities
    .map((a) => a.date)
    .filter(isValidDate)
    .map(normDate)
    .sort();
  if (validDates.length === 0) return startDate;
  const last = new Date(validDates[validDates.length - 1] + "T00:00:00");
  last.setDate(last.getDate() + 1);
  const y = last.getFullYear();
  const m = String(last.getMonth() + 1).padStart(2, "0");
  const d = String(last.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Activity Card ─────────────────────────────────────────────────────────────

function Card({
  act,
  color,
  onEdit,
  onDelete,
  onNavigate,
}: {
  act: Activity;
  color: Palette;
  onEdit: () => void;
  onDelete: () => void;
  onNavigate: () => void;
}) {
  return (
    <div
      onClick={onEdit}
      className="group bg-white rounded-xl border border-sand shadow-sm hover:shadow-md hover:border-sand transition-all cursor-pointer flex gap-3 items-start p-3.5"
    >
      {/* Time badge */}
      <div className="flex-shrink-0 w-14 pt-0.5">
        {act.time ? (
          <span
            className={`block text-center ${color.time} text-xs font-bold px-1.5 py-1 rounded-lg`}
          >
            {act.time}
          </span>
        ) : (
          <div className="w-2 h-2 rounded-full bg-sand mt-1.5 mx-auto" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-ink leading-snug">
          {act.activity || (
            <span className="text-dune font-normal italic">
              Chưa có tên
            </span>
          )}
        </p>
        {(act.address || act.notes) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {act.address && (
              <span className="flex items-center gap-1">
                <MapPin size={9} className="flex-shrink-0 text-dune" />
                <span className="truncate max-w-[130px] text-xs text-stone">
                  {act.address}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate();
                  }}
                  className="flex items-center gap-0.5 text-[10px] font-semibold text-terra bg-terra-pale px-1.5 py-0.5 rounded-full flex-shrink-0 active:bg-terra-pale transition-colors"
                >
                  <Navigation size={8} />
                  Dẫn đường
                </button>
              </span>
            )}
            {act.notes && (
              <span className="text-xs text-stone italic truncate max-w-[140px]">
                {act.notes}
              </span>
            )}
          </div>
        )}
        {/* Địa chỉ dự phòng */}
        {(act.backups ?? []).filter((b) => b.address).length > 0 && (
          <div className="mt-1.5 pl-3 border-l-2 border-sand space-y-1">
            {(act.backups ?? [])
              .filter((b) => b.address)
              .map((b, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[10px] text-dune font-medium flex-shrink-0">
                    Dự phòng {i + 1}:
                  </span>
                  <span className="truncate max-w-[120px] text-xs text-stone">
                    {b.address}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      openDirections(b);
                    }}
                    className="flex items-center gap-0.5 text-[10px] font-semibold text-terra bg-terra-pale px-1.5 py-0.5 rounded-full flex-shrink-0 active:bg-terra-pale transition-colors"
                  >
                    <Navigation size={8} />
                    Dẫn đường
                  </button>
                </div>
              ))}
          </div>
        )}
      </div>

      {/* Delete — always visible on mobile, brighter on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-sand hover:text-wine hover:bg-wine-pale transition-colors -mt-0.5 -mr-0.5"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

// ── Edit Form ─────────────────────────────────────────────────────────────────

function EditForm({
  form,
  color,
  saving,
  onChange,
  onSave,
  onCancel,
}: {
  form: FormData;
  color: Palette;
  saving: boolean;
  onChange: (f: FormData) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inp =
    "w-full border border-sand bg-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-terra/25 focus:border-terra placeholder:text-dune transition-all";

  return (
    <div
      className={`${color.light} border ${color.border} rounded-2xl p-4 space-y-3.5 shadow-sm`}
    >
      {/* Date + Time — stack on mobile, side-by-side on sm+ with proportional widths */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="sm:flex-[3]">
          <span className="text-xs font-semibold text-stone block mb-1.5">
            Ngày
          </span>
          <DatePicker
            value={form.date}
            onChange={(v) => onChange({ ...form, date: v })}
            placeholder="Chọn ngày"
          />
        </div>
        <div className="sm:flex-[2]">
          <span className="text-xs font-semibold text-stone block mb-1.5">
            Thời gian
          </span>
          <TimePicker
            value={form.time}
            onChange={(v) => onChange({ ...form, time: v })}
          />
        </div>
      </div>

      {/* Activity name */}
      <div>
        <span className="text-xs font-semibold text-stone block mb-1.5">
          Hoạt động
        </span>
        <input
          autoFocus
          className={inp}
          value={form.activity}
          onChange={(e) => onChange({ ...form, activity: e.target.value })}
          placeholder="Tên hoạt động, địa điểm tham quan..."
          onKeyDown={(e) => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
        />
      </div>

      {/* Address */}
      <div>
        <span className="text-xs font-semibold text-stone block mb-1.5">
          Địa chỉ
        </span>
        <PlacesAutocomplete
          value={form.address}
          onChange={(v, coords) =>
            onChange({ ...form, address: v, lat: coords?.lat ?? null, lon: coords?.lon ?? null })
          }
          placeholder="Tìm địa điểm..."
          className={inp}
        />
      </div>

      {/* Backup addresses — chỗ thay thế nếu địa điểm chính không đi được */}
      <div>
        <span className="text-xs font-semibold text-stone block mb-1.5">
          Địa chỉ dự phòng
        </span>
        <div className="space-y-2">
          {(form.backups ?? []).map((b, i) => (
            <div key={i} className="flex items-start gap-2">
              <div className="flex-1">
                <PlacesAutocomplete
                  value={b.address}
                  onChange={(v, coords) => {
                    const next = [...(form.backups ?? [])];
                    next[i] = { address: v, lat: coords?.lat ?? null, lon: coords?.lon ?? null };
                    onChange({ ...form, backups: next });
                  }}
                  placeholder={`Địa điểm dự phòng ${i + 1}...`}
                  className={inp}
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  const next = (form.backups ?? []).filter((_, j) => j !== i);
                  onChange({ ...form, backups: next });
                }}
                className="mt-2 p-2 text-stone hover:text-terra hover:bg-black/5 rounded-lg transition-colors shrink-0"
                aria-label="Xóa địa chỉ dự phòng"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            const next: BackupAddress[] = [
              ...(form.backups ?? []),
              { address: "", lat: null, lon: null },
            ];
            onChange({ ...form, backups: next });
          }}
          className="mt-2 inline-flex items-center gap-1.5 text-sm text-terra hover:text-terra-dark font-semibold transition-colors"
        >
          <Plus size={16} /> Thêm địa chỉ dự phòng
        </button>
      </div>

      {/* Notes row */}
      <div>
        <span className="text-xs font-semibold text-stone block mb-1.5">
          Ghi chú
        </span>
        <input
          className={inp}
          value={form.notes}
          onChange={(e) => onChange({ ...form, notes: e.target.value })}
          placeholder="Ghi chú thêm"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-0.5">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-stone hover:bg-black/5 rounded-xl transition-colors font-medium"
        >
          Hủy
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-5 py-2 text-sm bg-terra hover:bg-terra-dark disabled:opacity-60 text-white rounded-xl font-semibold transition-colors"
        >
          {saving ? "Đang lưu..." : "Lưu"}
        </button>
      </div>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function Itinerary({
  activities,
  startDate = "",
  destination = "",
  destLat = null,
  destLon = null,
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(BLANK);
  const [saving, setSaving] = useState(false);
  const [weather, setWeather] = useState<Record<string, DayWeather>>({});

  // Dự báo thời tiết cho điểm đến. Ưu tiên toạ độ lưu sẵn của trip; không có
  // thì geocode chuỗi điểm đến. ~16 ngày tới.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let coords: { lat: number; lon: number } | null =
        destLat != null && destLon != null ? { lat: destLat, lon: destLon } : null;
      if (!coords) {
        if (!destination) return;
        coords = await geocodePlace(destination);
      }
      if (!coords || cancelled) return;
      const w = await fetchWeather(coords.lat, coords.lon);
      if (!cancelled) setWeather(w);
    })();
    return () => { cancelled = true; };
  }, [destination, destLat, destLon]);

  // Group by date
  const dateMap = new Map<string, Activity[]>();
  const ungrouped: Activity[] = [];
  for (const a of activities) {
    if (isValidDate(a.date)) {
      if (!dateMap.has(a.date)) dateMap.set(a.date, []);
      dateMap.get(a.date)!.push(a);
    } else {
      ungrouped.push(a);
    }
  }
  const sortedDates = [...dateMap.keys()].sort((a, b) =>
    normDate(a).localeCompare(normDate(b)),
  );
  for (const acts of dateMap.values())
    acts.sort((a, b) => a.time.localeCompare(b.time));

  const startEdit = (a: Activity) => {
    setAddDate(null);
    setEditId(a.id);
    setForm({
      date: a.date,
      time: a.time,
      activity: a.activity,
      address: a.address,
      lat: a.lat ?? null,
      lon: a.lon ?? null,
      backups: a.backups ?? [],
      cost: a.cost,
      notes: a.notes,
      position: a.position,
    });
  };

  const startAdd = (date: string) => {
    setEditId(null);
    setAddDate(date);
    const defaultDate = date || nextDefaultDate(activities, startDate);
    setForm({ ...BLANK, date: defaultDate });
  };

  const cancel = () => {
    setEditId(null);
    setAddDate(null);
    setForm(BLANK);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (editId) await onUpdate(editId, form);
      else await onAdd({ ...form, position: activities.length });
      cancel();
    } finally {
      setSaving(false);
    }
  };

  // Tối ưu thứ tự các hoạt động trong 1 ngày theo tuyến gần nhau nhất.
  // Giữ nguyên tập giá trị position của ngày đó → không ảnh hưởng ngày khác.
  const optimizeDay = async (acts: Activity[]) => {
    const order = optimizeOrder(acts);
    const positions = acts.map((a) => a.position).sort((x, y) => x - y);
    for (let k = 0; k < order.length; k++) {
      const act = acts[order[k]];
      if (act.position !== positions[k]) await onUpdate(act.id, { position: positions[k] });
    }
  };

  const isEditing = editId !== null || addDate !== null;
  const isEmpty = activities.length === 0 && !isEditing;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28">
      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-parchment rounded-2xl flex items-center justify-center mx-auto mb-5">
            <CalendarDays size={28} className="text-dune" />
          </div>
          <h3 className="text-lg font-bold text-ink mb-2">
            Chưa có hoạt động nào
          </h3>
          <p className="text-stone text-sm mb-8 max-w-xs mx-auto leading-relaxed">
            Bắt đầu lên kế hoạch từng ngày, từng địa điểm cho chuyến đi
            của bạn.
          </p>
          <button
            onClick={() => startAdd("")}
            className="inline-flex items-center gap-2 bg-terra hover:bg-terra-dark text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
          >
            <Plus size={15} />
            Thêm hoạt động đầu tiên
          </button>
        </div>
      )}

      <div className="space-y-10">
        {/* ── Day groups ── */}
        {sortedDates.map((date, di) => {
          const acts = dateMap.get(date)!;
          const color = PALETTE[di % PALETTE.length];
          const isAddingHere = addDate === date;
          // Hide the timeline line whenever this day has a form open
          const isDayEditing =
            isAddingHere || acts.some((a) => a.id === editId);

          return (
            <section key={date}>
              {/* Day header */}
              <div className="flex items-center gap-2.5 mb-5">
                <span
                  className={`${color.pill} text-white text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0 shadow-sm`}
                >
                  Ngày {di + 1}
                </span>
                <span
                  className={`text-sm font-semibold ${color.accent} truncate`}
                >
                  {fmtDate(date) || date}
                </span>
                {weather[normDate(date)] && (() => {
                  const w = weather[normDate(date)];
                  const info = weatherInfo(w.code);
                  return (
                    <span
                      title={info.label}
                      className="flex items-center gap-1 text-xs font-medium text-stone flex-shrink-0"
                    >
                      <span>{info.emoji}</span>
                      <span>{w.tMax}°<span className="text-dune">/{w.tMin}°</span></span>
                    </span>
                  );
                })()}
                <div className="flex-1 h-px bg-parchment min-w-4" />
                {acts.filter((a) => a.lat != null && a.lon != null).length >= 3 && (
                  <button
                    onClick={() => void optimizeDay(acts)}
                    title="Sắp xếp theo tuyến gần nhau nhất"
                    className="flex items-center gap-1 text-[11px] font-semibold text-terra-dark bg-parchment hover:bg-parchment px-2 py-1 rounded-full flex-shrink-0 transition-colors"
                  >
                    <Shuffle size={12} /> Tối ưu tuyến
                  </button>
                )}
              </div>

              {/* Bản đồ tổng ngày — pin đánh số theo thứ tự hoạt động */}
              {(() => {
                const url = dayMapUrl(acts);
                return url ? (
                  <img
                    src={url}
                    alt={`Bản đồ ngày ${di + 1}`}
                    loading="lazy"
                    className="w-full h-[120px] object-cover rounded-xl border border-sand mb-4"
                  />
                ) : null;
              })()}

              {/* Timeline */}
              <div className="relative">
                {/* Vertical connector line — hidden when any form is open in this day */}
                {acts.length > 1 && !isDayEditing && (
                  <div
                    className={`absolute left-[5px] top-5 w-0.5 ${color.line} z-0`}
                    style={{ height: `calc(100% - 2.5rem)` }}
                  />
                )}

                <div className="space-y-3">
                  {acts.map((act) =>
                    editId === act.id ? (
                      <EditForm
                        key={act.id}
                        form={form}
                        color={color}
                        saving={saving}
                        onChange={setForm}
                        onSave={save}
                        onCancel={cancel}
                      />
                    ) : (
                      <div
                        key={act.id}
                        className="flex gap-3 items-start relative z-[1]"
                      >
                        {/* Timeline dot */}
                        <div
                          className={`flex-shrink-0 w-3 h-3 rounded-full mt-4 ring-2 ring-white shadow-sm ${color.dot}`}
                        />
                        {/* Card */}
                        <div className="flex-1 min-w-0">
                          <Card
                            act={act}
                            color={color}
                            onEdit={() => startEdit(act)}
                            onDelete={() => onDelete(act.id)}
                            onNavigate={() => openDirections(act)}
                          />
                        </div>
                      </div>
                    ),
                  )}

                  {/* Inline add form for this day */}
                  {isAddingHere && (
                    <EditForm
                      form={form}
                      color={color}
                      saving={saving}
                      onChange={setForm}
                      onSave={save}
                      onCancel={cancel}
                    />
                  )}
                </div>
              </div>

              {/* Per-day "Add" button */}
              {!isEditing && (
                <button
                  onClick={() => startAdd(date)}
                  className="mt-3 ml-6 flex items-center gap-1.5 text-xs font-semibold text-stone hover:text-terra transition-colors py-1"
                >
                  <Plus size={13} />
                  Thêm hoạt động ngày {di + 1}
                </button>
              )}
            </section>
          );
        })}

        {/* ── Ungrouped ── */}
        {ungrouped.length > 0 && (
          <section>
            <div className="flex items-center gap-2.5 mb-5">
              <span className="bg-dune text-white text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0">
                Chưa có ngày
              </span>
              <div className="flex-1 h-px bg-parchment" />
            </div>
            <div className="space-y-3">
              {ungrouped.map((act) =>
                editId === act.id ? (
                  <EditForm
                    key={act.id}
                    form={form}
                    color={PALETTE[sortedDates.length % PALETTE.length]}
                    saving={saving}
                    onChange={setForm}
                    onSave={save}
                    onCancel={cancel}
                  />
                ) : (
                  <div key={act.id} className="flex gap-3 items-start">
                    <div className="flex-shrink-0 w-3 h-3 rounded-full mt-4 ring-2 ring-white bg-dune" />
                    <div className="flex-1 min-w-0">
                      <Card
                        act={act}
                        color={PALETTE[sortedDates.length % PALETTE.length]}
                        onEdit={() => startEdit(act)}
                        onDelete={() => onDelete(act.id)}
                        onNavigate={() => openDirections(act)}
                      />
                    </div>
                  </div>
                ),
              )}
            </div>
          </section>
        )}

        {/* ── Global new-activity form (no date preselected) ── */}
        {addDate === "" && (
          <EditForm
            form={form}
            color={PALETTE[sortedDates.length % PALETTE.length]}
            saving={saving}
            onChange={setForm}
            onSave={save}
            onCancel={cancel}
          />
        )}

      </div>

      {/* ── Floating Add Button (FAB) ── */}
      {!isEditing && (
        <button
          onClick={() => startAdd("")}
          className="fixed bottom-6 right-6 z-20 w-14 h-14 bg-terra hover:bg-terra-dark text-white rounded-2xl shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
          title="Thêm hoạt động"
        >
          <Plus size={24} />
        </button>
      )}
    </div>
  );
}
