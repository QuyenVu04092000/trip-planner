import { useState, useEffect, useCallback } from "react";
import {
  ArrowLeft,
  Map,
  CalendarDays,
  TableProperties,
  GalleryHorizontal,
  Pencil,
} from "lucide-react";
import type { Trip, Activity, MediaItem } from "../types";
import {
  fetchActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  fetchMediaItems,
  updateTrip,
} from "../utils/db";
import Itinerary from "./Itinerary";
import Memory from "./Memory";
import CreateTripModal from "./CreateTripModal";

interface Props {
  trip: Trip;
  onBack: () => void;
  onTripUpdate: (trip: Trip) => void;
}

import { formatDateRange, getCountdown } from "../utils/format";

export default function TripDetail({ trip, onBack, onTripUpdate }: Props) {
  const [tab, setTab] = useState<"plan" | "memory">("plan");
  const [activities, setActivities] = useState<Activity[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);

  useEffect(() => {
    setPlanLoading(true);
    fetchActivities(trip.id)
      .then(setActivities)
      .catch(console.error)
      .finally(() => setPlanLoading(false));
    fetchMediaItems(trip.id).then(setMedia).catch(console.error);
  }, [trip.id]);

  const handleAdd = useCallback(
    async (fields: Omit<Activity, "id" | "tripId" | "createdAt">) => {
      const newAct = await createActivity(trip.id, fields);
      setActivities((prev) => [...prev, newAct]);
    },
    [trip.id],
  );

  const handleUpdate = useCallback(
    async (
      id: string,
      fields: Partial<Omit<Activity, "id" | "tripId" | "createdAt">>,
    ) => {
      await updateActivity(id, fields);
      setActivities((prev) =>
        prev.map((a) => (a.id === id ? { ...a, ...fields } : a)),
      );
    },
    [],
  );

  const handleDelete = useCallback(async (id: string) => {
    await deleteActivity(id);
    setActivities((prev) => prev.filter((a) => a.id !== id));
  }, []);

  const handleMediaChange = useCallback((items: MediaItem[]) => {
    setMedia(items);
  }, []);

  const handleEditSave = useCallback(
    async (fields: Omit<Trip, "id" | "createdAt" | "updatedAt">) => {
      const updated: Trip = {
        ...trip,
        ...fields,
        updatedAt: new Date().toISOString(),
      };
      await updateTrip(updated);
      onTripUpdate(updated);
      setShowEdit(false);
    },
    [trip, onTripUpdate],
  );

  const imageCount = media.filter((m) => m.type === "image").length;
  const videoCount = media.filter((m) => m.type === "video").length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-30">
        {/* Frosted glass nav bar */}
        <div className="bg-white/80 backdrop-blur-xl border-b border-slate-100/80 shadow-sm pt-safe">
          <div className="px-4 py-3 flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-9 h-9 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors flex-shrink-0"
            >
              <ArrowLeft size={16} />
            </button>
            <span className="text-xl flex-shrink-0">{trip.emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="text-slate-900 font-bold text-[15px] truncate leading-tight">
                  {trip.name}
                </h1>
                {(() => {
                  const cd = getCountdown(trip.startDate, trip.endDate);
                  if (cd.type === 'today') return (
                    <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-600 animate-pulse">
                      Hôm nay! 🎉
                    </span>
                  );
                  if (cd.type === 'ongoing') return (
                    <span className="flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-600">
                      Đang diễn ra
                    </span>
                  );
                  if (cd.type === 'upcoming') return (
                    <span className={`flex-shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      cd.days <= 3 ? 'bg-amber-100 text-amber-600' :
                      cd.days <= 7 ? 'bg-orange-100 text-orange-600' :
                      'bg-blue-100 text-blue-600'
                    }`}>
                      {cd.label}
                    </span>
                  );
                  return null;
                })()}
              </div>
              <div className="flex items-center gap-2 text-slate-400 text-xs mt-0.5">
                {trip.destination && (
                  <span className="hidden sm:flex items-center gap-1 min-w-0 truncate max-w-[120px]">
                    <Map size={10} className="flex-shrink-0" />
                    {trip.destination}
                  </span>
                )}
                <span className="flex items-center gap-1 flex-shrink-0">
                  <CalendarDays size={10} />
                  {formatDateRange(
                    trip.startDate,
                    trip.endDate,
                    "Chưa đặt ngày",
                  )}
                </span>
              </div>
            </div>
            <button
              onClick={() => setShowEdit(true)}
              className="w-9 h-9 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors flex-shrink-0"
            >
              <Pencil size={14} />
            </button>
          </div>

          {/* Tab bar — same glass surface, just a separator line */}
          <div className="px-4 flex items-center border-t border-slate-100/60">
            <button
              onClick={() => setTab("plan")}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                tab === "plan"
                  ? "text-blue-600"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <TableProperties size={13} />
              Kế hoạch
              {tab === "plan" && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-blue-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setTab("memory")}
              className={`relative flex items-center gap-2 px-4 py-2.5 text-sm font-semibold transition-all ${
                tab === "memory"
                  ? "text-amber-500"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <GalleryHorizontal size={13} />
              Kỷ niệm
              {media.length > 0 && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    tab === "memory"
                      ? "bg-amber-100 text-amber-600"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {imageCount + videoCount}
                </span>
              )}
              {tab === "memory" && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-amber-400 rounded-full" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col pb-safe">
        {tab === "plan" ? (
          <div className="flex-1 overflow-auto">
            {planLoading ? (
              <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                Đang tải kế hoạch...
              </div>
            ) : (
              <Itinerary
                activities={activities}
                startDate={trip.startDate}
                onAdd={handleAdd}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            )}
          </div>
        ) : (
          <div className="flex-1 overflow-hidden flex flex-col">
            <Memory
              tripId={trip.id}
              items={media}
              onChange={handleMediaChange}
              startDate={trip.startDate}
              endDate={trip.endDate}
            />
          </div>
        )}
      </div>

      {showEdit && (
        <CreateTripModal
          initialTrip={trip}
          onClose={() => setShowEdit(false)}
          onSave={handleEditSave}
        />
      )}
    </div>
  );
}
