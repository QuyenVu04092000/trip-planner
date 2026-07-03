import { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowLeft,
  Map,
  CalendarDays,
  TableProperties,
  GalleryHorizontal,
  Pencil,
  UserPlus,
  Wallet,
  LogOut,
  Sparkles,
} from "lucide-react";
import type {
  Trip,
  Activity,
  MediaItem,
  TripMember,
  TripExpense,
  TripFund,
  TripFundPayment,
  Suggestion,
} from "../types";
import {
  fetchActivities,
  createActivity,
  updateActivity,
  deleteActivity,
  fetchMediaItems,
  updateTrip,
  fetchTripMembers,
  isOwner as fetchIsOwner,
  fetchExpenses,
  fetchFunds,
  fetchFundPayments,
} from "../utils/db";
import { supabase } from "../utils/supabase";
import { scheduleActivityNotifications } from "../utils/activityNotifications";
import {
  updateWidgetFromTrip,
  findNearestTrip,
  syncNearestTripToWidget,
} from "../utils/widgetBridge";
import Itinerary from "./Itinerary";
import SuggestionsModal from "./SuggestionsModal";
import Memory from "./Memory";
import ExpenseTab from "./ExpenseTab";
import CreateTripModal from "./CreateTripModal";
import InviteModal from "./InviteModal";

interface Props {
  trip: Trip;
  allTrips: Trip[];
  initialTab?: "plan" | "memory" | "expense";
  onBack: () => void;
  onTabChange?: (tab: "plan" | "memory" | "expense") => void;
  onTripUpdate: (trip: Trip) => void;
  onLogout: () => void;
}

import { formatDateRange, getCountdown } from "../utils/format";

export default function TripDetail({
  trip,
  allTrips,
  initialTab = "plan",
  onBack,
  onTabChange,
  onTripUpdate,
  onLogout,
}: Props) {
  const [tab, setTabState] = useState<"plan" | "memory" | "expense">(
    initialTab,
  );

  function setTab(next: "plan" | "memory" | "expense") {
    setTabState(next);
    onTabChange?.(next);
  }
  const [activities, setActivities] = useState<Activity[]>([]);
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [planLoading, setPlanLoading] = useState(true);
  const [showEdit, setShowEdit] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [members, setMembers] = useState<TripMember[]>([]);
  const [ownerStatus, setOwnerStatus] = useState(false);
  const [currentUserId, setCurrentUserId] = useState("");
  const [expenses, setExpenses] = useState<TripExpense[]>([]);
  const [funds, setFunds] = useState<TripFund[]>([]);
  const [fundPayments, setFundPayments] = useState<TripFundPayment[]>([]);
  const widgetReady = useRef(false);

  useEffect(() => {
    widgetReady.current = false;
    setPlanLoading(true);

    const activitiesP = fetchActivities(trip.id)
      .then((acts) => {
        setActivities(acts);
        scheduleActivityNotifications(acts);
        return acts;
      })
      .catch((e) => {
        console.error(e);
        return [] as Activity[];
      });

    const mediaP = fetchMediaItems(trip.id)
      .then((items) => {
        setMedia(items);
        return items;
      })
      .catch(() => [] as MediaItem[]);
    const expensesP = fetchExpenses(trip.id)
      .then((exps) => {
        setExpenses(exps);
        return exps;
      })
      .catch(() => [] as TripExpense[]);
    const fundsP = fetchFunds(trip.id)
      .then((fds) => {
        setFunds(fds);
        return fds;
      })
      .catch(() => [] as TripFund[]);
    const fundPaymentsP = fetchFundPayments(trip.id)
      .then((fps) => {
        setFundPayments(fps);
        return fps;
      })
      .catch(() => [] as TripFundPayment[]);

    fetchTripMembers(trip.id).then(setMembers).catch(console.error);
    fetchIsOwner(trip.id).then(setOwnerStatus);
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) setCurrentUserId(user.id);
    });

    Promise.all([activitiesP, mediaP, expensesP, fundsP, fundPaymentsP]).then(
      ([acts, mediaItems, exps, fds, fps]) => {
        widgetReady.current = true;
        // Only push the open trip if it's the nearest one; otherwise push the
        // real nearest trip so the widget never shows a non-nearest trip.
        if (findNearestTrip(allTrips)?.id === trip.id) {
          void updateWidgetFromTrip({
            trip,
            activities: acts,
            expenses: exps,
            funds: fds,
            fundPayments: fps,
            media: mediaItems,
          });
        } else {
          void syncNearestTripToWidget(allTrips);
        }
      },
    );

    activitiesP.finally(() => setPlanLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trip.id]);

  // ── Cộng tác real-time ──────────────────────────────────────────────────────
  // Ai đó (thành viên khác) sửa hoạt động/chi tiêu/quỹ → tự refetch & cập nhật.
  useEffect(() => {
    const tid = trip.id;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refetch = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void fetchActivities(tid).then(setActivities).catch(() => {});
        void fetchExpenses(tid).then(setExpenses).catch(() => {});
        void fetchFunds(tid).then(setFunds).catch(() => {});
        void fetchFundPayments(tid).then(setFundPayments).catch(() => {});
      }, 600); // gộp nhiều thay đổi liên tiếp
    };

    const filter = `trip_id=eq.${tid}`;
    const channel = supabase
      .channel(`trip_${tid}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "activities", filter }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_expenses", filter }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_funds", filter }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "trip_fund_payments", filter }, refetch)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      void supabase.removeChannel(channel);
    };
  }, [trip.id]);

  // Realtime widget sync — fires whenever any relevant data changes after initial load
  useEffect(() => {
    console.log(
      "[Widget] reactive check — ready:",
      widgetReady.current,
      "| startDate:",
      trip.startDate,
    );
    if (!widgetReady.current) return;
    if (findNearestTrip(allTrips)?.id === trip.id) {
      void updateWidgetFromTrip({
        trip,
        activities,
        expenses,
        funds,
        fundPayments,
      });
    } else {
      void syncNearestTripToWidget(allTrips);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    trip.startDate,
    trip.endDate,
    trip.name,
    trip.emoji,
    expenses,
    funds,
    fundPayments,
    activities,
    allTrips,
  ]);

  const handleAdd = useCallback(
    async (fields: Omit<Activity, "id" | "tripId" | "createdAt">) => {
      const newAct = await createActivity(trip.id, fields);
      setActivities((prev) => {
        const next = [...prev, newAct];
        scheduleActivityNotifications(next);
        return next;
      });
    },
    [trip.id],
  );

  // Thêm 1 gợi ý thành hoạt động trong lịch trình (chưa gán ngày/giờ — user tự sắp)
  const handleAddSuggestion = useCallback(
    async (s: Suggestion) => {
      await handleAdd({
        date: trip.startDate ?? "",
        time: "",
        activity: s.name,
        address: s.address ?? "",
        cost: "",
        notes: s.description ?? "",
        position: Date.now(),
      });
    },
    [handleAdd, trip.startDate],
  );

  const handleUpdate = useCallback(
    async (
      id: string,
      fields: Partial<Omit<Activity, "id" | "tripId" | "createdAt">>,
    ) => {
      await updateActivity(id, fields);
      setActivities((prev) => {
        const next = prev.map((a) => (a.id === id ? { ...a, ...fields } : a));
        scheduleActivityNotifications(next);
        return next;
      });
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
    <div className="h-[100svh] bg-slate-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="sticky top-0 z-30">
        {/* Frosted glass nav bar */}
        <div className="bg-white/80 backdrop-blur-xl border-b border-slate-100/80 shadow-sm pt-safe">
          {/* Dòng 1: back + tên + actions chính */}
          <div className="px-4 py-2.5 flex items-center gap-2">
            <button
              onClick={onBack}
              className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 transition-colors flex-shrink-0"
            >
              <ArrowLeft size={15} />
            </button>
            <span className="text-lg flex-shrink-0">{trip.emoji}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <h1 className="text-slate-900 font-bold text-[15px] truncate leading-tight">
                  {trip.name}
                </h1>
                {(() => {
                  const cd = getCountdown(trip.startDate, trip.endDate);
                  if (cd.type === "today")
                    return (
                      <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-600 animate-pulse">
                        Hôm nay! 🎉
                      </span>
                    );
                  if (cd.type === "ongoing")
                    return (
                      <span className="flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-600">
                        Đang diễn ra
                      </span>
                    );
                  if (cd.type === "upcoming")
                    return (
                      <span
                        className={`flex-shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                          cd.days <= 3
                            ? "bg-amber-100 text-amber-600"
                            : cd.days <= 7
                              ? "bg-orange-100 text-orange-600"
                              : "bg-blue-100 text-blue-600"
                        }`}
                      >
                        {cd.label}
                      </span>
                    );
                  return null;
                })()}
              </div>
            </div>
            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => setShowInvite(true)}
                className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
              >
                <UserPlus size={13} />
              </button>
              {ownerStatus && (
                <button
                  onClick={() => setShowEdit(true)}
                  className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
                >
                  <Pencil size={13} />
                </button>
              )}
              <button
                onClick={onLogout}
                title="Đăng xuất"
                className="w-8 h-8 bg-slate-100 hover:bg-slate-200 rounded-xl flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors"
              >
                <LogOut size={13} />
              </button>
            </div>
          </div>

          {/* Dòng 2: date + avatars */}
          <div className="px-4 pb-2 flex items-center gap-2">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs flex-1 min-w-0">
              {trip.destination && (
                <span className="hidden sm:flex items-center gap-1 truncate max-w-[100px]">
                  <Map size={10} className="flex-shrink-0" />
                  {trip.destination}
                </span>
              )}
              <span className="flex items-center gap-1 truncate">
                <CalendarDays size={10} className="flex-shrink-0" />
                {formatDateRange(trip.startDate, trip.endDate, "Chưa đặt ngày")}
              </span>
            </div>
            {members.length > 1 && (
              <div className="flex items-center -space-x-1.5 flex-shrink-0">
                {members.slice(0, 4).map((m) => {
                  const colors = [
                    "bg-blue-400",
                    "bg-violet-400",
                    "bg-pink-400",
                    "bg-amber-400",
                    "bg-emerald-400",
                  ];
                  let hash = 0;
                  for (const c of m.userEmail)
                    hash = (hash * 31 + c.charCodeAt(0)) & 0xfffff;
                  const bg = colors[hash % colors.length];
                  return (
                    <div
                      key={m.id}
                      className={`w-6 h-6 rounded-full border-2 border-white flex items-center justify-center text-white text-[9px] font-bold ${bg}`}
                    >
                      {m.displayName.slice(0, 2).toUpperCase()}
                    </div>
                  );
                })}
                {members.length > 4 && (
                  <div className="w-6 h-6 rounded-full border-2 border-white bg-slate-200 flex items-center justify-center text-slate-500 text-[9px] font-bold">
                    +{members.length - 4}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Tab bar — same glass surface, just a separator line */}
          <div className="px-4 flex items-center border-t border-slate-100/60">
            <button
              onClick={() => setTab("plan")}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold transition-all whitespace-nowrap ${
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
              onClick={() => setTab("expense")}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold transition-all whitespace-nowrap ${
                tab === "expense"
                  ? "text-emerald-600"
                  : "text-slate-400 hover:text-slate-600"
              }`}
            >
              <Wallet size={13} />
              Chi tiêu
              {expenses.length > 0 && (
                <span
                  className={`text-xs px-1.5 py-0.5 rounded-full font-semibold ${
                    tab === "expense"
                      ? "bg-emerald-100 text-emerald-600"
                      : "bg-slate-100 text-slate-400"
                  }`}
                >
                  {expenses.length}
                </span>
              )}
              {tab === "expense" && (
                <span className="absolute bottom-0 inset-x-2 h-0.5 bg-emerald-500 rounded-full" />
              )}
            </button>
            <button
              onClick={() => setTab("memory")}
              className={`relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-semibold transition-all whitespace-nowrap ${
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
        {tab === "expense" ? (
          <ExpenseTab
            tripId={trip.id}
            tripName={trip.name}
            expenses={expenses}
            members={members}
            currentUserId={currentUserId}
            isOwner={ownerStatus}
            funds={funds}
            fundPayments={fundPayments}
            onChange={setExpenses}
            onFundsChange={(f, p) => {
              setFunds(f);
              setFundPayments(p);
            }}
          />
        ) : tab === "plan" ? (
          <div className="flex-1 overflow-auto">
            {planLoading ? (
              <div className="flex items-center justify-center h-40 text-slate-400 text-sm">
                Đang tải kế hoạch...
              </div>
            ) : (
              <Itinerary
                activities={activities}
                startDate={trip.startDate}
                destination={trip.destination}
                destLat={trip.lat}
                destLon={trip.lon}
                onAdd={handleAdd}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            )}
            {/* Nút gợi ý địa điểm (bottom-left, tránh đè FAB "thêm" bên phải) */}
            {!planLoading && (
              <button
                onClick={() => setShowSuggestions(true)}
                title="Gợi ý địa điểm"
                className="fixed bottom-6 left-6 z-20 h-14 pl-4 pr-5 bg-violet-600 hover:bg-violet-700 text-white rounded-2xl shadow-xl hover:shadow-2xl flex items-center gap-2 transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
              >
                <Sparkles size={20} />
                <span className="text-sm font-semibold">Gợi ý</span>
              </button>
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

      {showInvite && (
        <InviteModal
          trip={trip}
          currentUserId={currentUserId}
          isOwner={ownerStatus}
          onClose={() => setShowInvite(false)}
          onLeave={onBack}
        />
      )}

      {showSuggestions && (
        <SuggestionsModal
          tripId={trip.id}
          destination={trip.destination}
          onAdd={handleAddSuggestion}
          onClose={() => setShowSuggestions(false)}
        />
      )}
    </div>
  );
}
