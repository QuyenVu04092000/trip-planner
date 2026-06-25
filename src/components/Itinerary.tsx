import { useState } from "react";
import {
  Plus,
  Trash2,
  MapPin,
  CalendarDays,
  DollarSign,
  Navigation,
} from "lucide-react";
import PlacesAutocomplete from "./PlacesAutocomplete";
import type { Activity } from "../types";
import DatePicker from "./DatePicker";
import TimePicker from "./TimePicker";
import MapView from "./MapView";
import { parseCost, fmtMoney } from "../utils/format";

const PALETTE = [
  {
    pill: "bg-blue-500",
    light: "bg-blue-50",
    accent: "text-blue-600",
    border: "border-blue-200",
    time: "bg-blue-100 text-blue-700",
    dot: "bg-blue-500",
    line: "bg-blue-100",
  },
  {
    pill: "bg-violet-500",
    light: "bg-violet-50",
    accent: "text-violet-600",
    border: "border-violet-200",
    time: "bg-violet-100 text-violet-700",
    dot: "bg-violet-500",
    line: "bg-violet-100",
  },
  {
    pill: "bg-emerald-500",
    light: "bg-emerald-50",
    accent: "text-emerald-600",
    border: "border-emerald-200",
    time: "bg-emerald-100 text-emerald-700",
    dot: "bg-emerald-500",
    line: "bg-emerald-100",
  },
  {
    pill: "bg-amber-500",
    light: "bg-amber-50",
    accent: "text-amber-600",
    border: "border-amber-200",
    time: "bg-amber-100 text-amber-700",
    dot: "bg-amber-500",
    line: "bg-amber-100",
  },
  {
    pill: "bg-rose-500",
    light: "bg-rose-50",
    accent: "text-rose-600",
    border: "border-rose-200",
    time: "bg-rose-100 text-rose-700",
    dot: "bg-rose-500",
    line: "bg-rose-100",
  },
  {
    pill: "bg-teal-500",
    light: "bg-teal-50",
    accent: "text-teal-600",
    border: "border-teal-200",
    time: "bg-teal-100 text-teal-700",
    dot: "bg-teal-500",
    line: "bg-teal-100",
  },
] as const;

type Palette = (typeof PALETTE)[number];
type FormData = Omit<Activity, "id" | "tripId" | "createdAt">;

const BLANK: FormData = {
  date: "",
  time: "",
  activity: "",
  address: "",
  cost: "",
  notes: "",
  position: 0,
};

interface Props {
  activities: Activity[];
  startDate?: string;
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

// parseCost, fmtMoney → imported from utils/format

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
      className="group bg-white rounded-xl border border-slate-100 shadow-sm hover:shadow-md hover:border-slate-200 transition-all cursor-pointer flex gap-3 items-start p-3.5"
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
          <div className="w-2 h-2 rounded-full bg-slate-200 mt-1.5 mx-auto" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm text-slate-800 leading-snug">
          {act.activity || (
            <span className="text-slate-300 font-normal italic">
              Chưa có tên
            </span>
          )}
        </p>
        {(act.address || act.cost || act.notes) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {act.address && (
              <span className="flex items-center gap-1">
                <MapPin size={9} className="flex-shrink-0 text-slate-300" />
                <span className="truncate max-w-[130px] text-xs text-slate-400">
                  {act.address}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigate();
                  }}
                  className="flex items-center gap-0.5 text-[10px] font-semibold text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded-full flex-shrink-0 active:bg-blue-100 transition-colors"
                >
                  <Navigation size={8} />
                  Dẫn đường
                </button>
              </span>
            )}
            {act.cost && (
              <span className="text-xs font-semibold text-emerald-600">
                {act.cost}đ
              </span>
            )}
            {act.notes && (
              <span className="text-xs text-slate-400 italic truncate max-w-[140px]">
                {act.notes}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Delete — always visible on mobile, brighter on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-slate-200 hover:text-rose-400 hover:bg-rose-50 transition-colors -mt-0.5 -mr-0.5"
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
    "w-full border border-slate-200 bg-white rounded-xl px-3.5 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400/30 focus:border-blue-400 placeholder:text-slate-300 transition-all";

  return (
    <div
      className={`${color.light} border ${color.border} rounded-2xl p-4 space-y-3.5 shadow-sm`}
    >
      {/* Date + Time — stack on mobile, side-by-side on sm+ with proportional widths */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="sm:flex-[3]">
          <span className="text-xs font-semibold text-slate-500 block mb-1.5">
            Ngày
          </span>
          <DatePicker
            value={form.date}
            onChange={(v) => onChange({ ...form, date: v })}
            placeholder="Chọn ngày"
          />
        </div>
        <div className="sm:flex-[2]">
          <span className="text-xs font-semibold text-slate-500 block mb-1.5">
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
        <span className="text-xs font-semibold text-slate-500 block mb-1.5">
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
        <span className="text-xs font-semibold text-slate-500 block mb-1.5">
          Địa chỉ
        </span>
        <PlacesAutocomplete
          value={form.address}
          onChange={(v) => onChange({ ...form, address: v })}
          placeholder="Tìm địa điểm..."
          className={inp}
        />
      </div>

      {/* Cost + Notes row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <span className="text-xs font-semibold text-slate-500 block mb-1.5">
            Chi phí
          </span>
          <input
            className={inp}
            value={form.cost}
            onChange={(e) => onChange({ ...form, cost: e.target.value })}
            placeholder="500000"
          />
        </div>
        <div>
          <span className="text-xs font-semibold text-slate-500 block mb-1.5">
            Ghi chú
          </span>
          <input
            className={inp}
            value={form.notes}
            onChange={(e) => onChange({ ...form, notes: e.target.value })}
            placeholder="Ghi chú thêm"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-0.5">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-500 hover:bg-black/5 rounded-xl transition-colors font-medium"
        >
          Hủy
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          className="px-5 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white rounded-xl font-semibold transition-colors"
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
  onAdd,
  onUpdate,
  onDelete,
}: Props) {
  const [editId, setEditId] = useState<string | null>(null);
  const [addDate, setAddDate] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>(BLANK);
  const [saving, setSaving] = useState(false);
  const [mapPlace, setMapPlace] = useState<Activity | null>(null);

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

  const grandTotal = activities.reduce((s, a) => s + parseCost(a.cost), 0);
  const isEditing = editId !== null || addDate !== null;
  const isEmpty = activities.length === 0 && !isEditing;

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-28">
      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="text-center py-20">
          <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <CalendarDays size={28} className="text-slate-300" />
          </div>
          <h3 className="text-lg font-bold text-slate-700 mb-2">
            Chưa có hoạt động nào
          </h3>
          <p className="text-slate-400 text-sm mb-8 max-w-xs mx-auto leading-relaxed">
            Bắt đầu lên kế hoạch từng ngày, địa điểm và chi phí cho chuyến đi
            của bạn.
          </p>
          <button
            onClick={() => startAdd("")}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition-colors shadow-sm"
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
          const dayTotal = acts.reduce((s, a) => s + parseCost(a.cost), 0);
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
                <div className="flex-1 h-px bg-slate-100 min-w-4" />
                {dayTotal > 0 && (
                  <span className="text-xs text-slate-400 font-semibold flex-shrink-0">
                    {fmtMoney(dayTotal)}
                  </span>
                )}
              </div>

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
                            onNavigate={() => setMapPlace(act)}
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
                  className="mt-3 ml-6 flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-blue-500 transition-colors py-1"
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
              <span className="bg-slate-300 text-white text-xs font-bold px-3 py-1.5 rounded-full flex-shrink-0">
                Chưa có ngày
              </span>
              <div className="flex-1 h-px bg-slate-100" />
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
                    <div className="flex-shrink-0 w-3 h-3 rounded-full mt-4 ring-2 ring-white bg-slate-300" />
                    <div className="flex-1 min-w-0">
                      <Card
                        act={act}
                        color={PALETTE[sortedDates.length % PALETTE.length]}
                        onEdit={() => startEdit(act)}
                        onDelete={() => onDelete(act.id)}
                        onNavigate={() => setMapPlace(act)}
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

        {/* ── Grand total ── */}
        {grandTotal > 0 && (
          <div className="rounded-2xl bg-slate-900 px-5 py-4 flex items-center justify-between">
            <div>
              <p className="text-[11px] text-white/40 font-bold uppercase tracking-widest mb-1">
                Tổng chi phí ước tính
              </p>
              <p className="text-2xl font-bold text-white">
                {fmtMoney(grandTotal)}
              </p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
              <DollarSign size={18} className="text-white/60" />
            </div>
          </div>
        )}
      </div>

      {/* ── Floating Add Button (FAB) ── */}
      {!isEditing && (
        <button
          onClick={() => startAdd("")}
          className="fixed bottom-6 right-6 z-20 w-14 h-14 bg-blue-600 hover:bg-blue-700 text-white rounded-2xl shadow-xl hover:shadow-2xl flex items-center justify-center transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
          title="Thêm hoạt động"
        >
          <Plus size={24} />
        </button>
      )}

      {mapPlace && (
        <MapView
          place={{ name: mapPlace.activity || mapPlace.address, address: mapPlace.address }}
          onClose={() => setMapPlace(null)}
        />
      )}
    </div>
  );
}
