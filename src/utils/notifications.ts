import type { Trip } from "../types";

const STORAGE_PREFIX = "tripmemo_notified_";

export type NotifPermission = "unsupported" | "default" | "granted" | "denied";

export function getNotifPermission(): NotifPermission {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotifPermission(): Promise<NotifPermission> {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  const result = await Notification.requestPermission();
  return result;
}

export function checkAndNotify(trips: Trip[]): void {
  if (!("Notification" in window) || Notification.permission !== "granted")
    return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];
  const key = `${STORAGE_PREFIX}${todayStr}`;
  const notified = new Set<string>(
    JSON.parse(localStorage.getItem(key) ?? "[]"),
  );

  for (const trip of trips) {
    if (!trip.startDate) continue;

    const [sy, sm, sd] = trip.startDate.split("-").map(Number);
    const start = new Date(sy, sm - 1, sd);
    const daysLeft = Math.round((start.getTime() - today.getTime()) / 86400000);

    const notifId = `${trip.id}_d${daysLeft}`;
    if (notified.has(notifId)) continue;

    let body = "";
    if (daysLeft === 0)
      body = `${trip.emoji} ${trip.name} bắt đầu hôm nay! Chúc chuyến đi vui vẻ 🎉`;
    else if (daysLeft === 1)
      body = `${trip.emoji} ${trip.name} — còn đúng 1 ngày nữa là xuất phát!`;
    else if (daysLeft === 2)
      body = `${trip.emoji} ${trip.name} — còn đúng 2 ngày nữa là xuất phát!`;
    else if (daysLeft === 3)
      body = `${trip.emoji} ${trip.name} — còn 3 ngày nữa, đã chuẩn bị chưa?`;
    else if (daysLeft === 4)
      body = `${trip.emoji} ${trip.name} — còn 4 ngày nữa, đã chuẩn bị chưa?`;
    else if (daysLeft === 5)
      body = `${trip.emoji} ${trip.name} — còn 5 ngày nữa, đã chuẩn bị chưa?`;
    else if (daysLeft === 6)
      body = `${trip.emoji} ${trip.name} — còn 6 ngày nữa, đã chuẩn bị chưa?`;
    else if (daysLeft === 7)
      body = `${trip.emoji} ${trip.name} — còn 1 tuần nữa là đi rồi!`;

    if (body) {
      try {
        new Notification("TripMemo ✈️", {
          body,
          tag: notifId,
          icon: "/favicon.ico",
        });
        notified.add(notifId);
      } catch {
        // Notification blocked silently
      }
    }
  }

  localStorage.setItem(key, JSON.stringify([...notified]));
}
