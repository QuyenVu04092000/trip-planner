export interface Trip {
  id: string;
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  coverColor: string;
  emoji: string;
  createdAt: string;
  updatedAt: string;
}

export interface Activity {
  id: string;
  tripId: string;
  date: string;
  time: string;
  activity: string;
  address: string;
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
  role: 'owner' | 'member';
  joinedAt: string;
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

export type AppPage =
  | { page: 'list' }
  | { page: 'trip'; tripId: string; tab: 'plan' | 'memory' | 'expense' }
  | { page: 'invite'; token: string };
