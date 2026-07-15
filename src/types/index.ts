export interface Trip {
  id: string;
  name: string;
  destination: string;
  lat?: number | null;   // toạ độ điểm đến (chọn từ bản đồ) — cho thời tiết & tính năng cần vị trí
  lon?: number | null;
  startDate: string;
  endDate: string;
  coverColor: string;
  emoji: string;
  createdAt: string;
  updatedAt: string;
}

// Địa chỉ dự phòng: chỗ thay thế nếu địa điểm chính không đi được
export interface BackupAddress {
  address: string;
  lat?: number | null;
  lon?: number | null;
}

export interface Activity {
  id: string;
  tripId: string;
  date: string;
  time: string;
  activity: string;
  address: string;
  lat?: number | null;   // toạ độ địa điểm (từ ô tìm kiếm) — để bản đồ/chỉ đường chính xác
  lon?: number | null;
  backups?: BackupAddress[]; // địa chỉ dự phòng (không giới hạn số lượng)
  cost: string;
  notes: string;
  position: number;
  createdAt: string;
}

export interface MediaItem {
  id: string;
  tripId: string;
  type: 'image' | 'video';
  name: string;
  size: number;
  caption: string;
  createdAt: string;
  takenAt?: string;
  storagePath: string;
  thumbnailPath?: string;
  publicUrl?: string;
  thumbnailUrl?: string;
}

export interface TripMember {
  id: string;
  tripId: string;
  userId: string;
  userEmail: string;
  displayName: string; // từ user_profiles, mặc định = email prefix
  role: 'owner' | 'member';
  joinedAt: string;
}

export interface UserProfile {
  userId: string;
  displayName: string;
}

export interface TripInvite {
  id: string;
  tripId: string;
  token: string;
  createdBy: string;
  tripName: string;
  tripEmoji: string;
  ownerEmail: string;
  status: 'active' | 'expired';
  expiresAt: string;
  createdAt: string;
}

export interface TripFund {
  id: string;
  tripId: string;
  description: string;
  amountPerPerson: number;
  createdBy: string;
  createdAt: string;
}

export interface TripFundPayment {
  id: string;
  fundId: string;
  tripId: string;
  userId: string;
  userEmail: string;
  paid: boolean;
  paidAt: string | null;
}

export interface ExpenseSplit {
  userId: string;
  email: string;
  amount: number;
}

export interface TripExpense {
  id: string;
  tripId: string;
  description: string;
  amount: number;
  paidBy: string;
  paidByEmail: string;
  splits: ExpenseSplit[];
  date: string;
  createdAt: string;
  fundId?: string | null;  // set khi chi từ quỹ
}

export type SuggestionCategory = 'food' | 'cafe' | 'attraction' | 'checkin';

export interface Suggestion {
  name: string;
  category: SuggestionCategory;
  description: string;
  area?: string;
  address: string;
  lat: number | null;
  lon: number | null;
  photoUrl?: string | null;  // ảnh thật (Wikimedia); null → fallback ảnh-map
  bestTime?: string;         // sáng / chiều / tối / cả ngày
  duration?: string;         // vd "1-2 giờ"
  priceLevel?: string;       // miễn phí / ₫ / ₫₫ / ₫₫₫
}

// Tuỳ chọn cá nhân hoá gợi ý
export interface SuggestionPrefs {
  companions?: string;
  interests?: string[];
}

export type AppPage =
  | { page: 'list' }
  | { page: 'trip'; tripId: string; tab: 'plan' | 'memory' | 'expense' }
  | { page: 'invite'; token: string };
