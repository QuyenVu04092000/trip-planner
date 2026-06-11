import { useState, useEffect, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Trip, AppPage } from './types';
import { fetchTrips, createTrip, deleteTrip } from './utils/db';
import { supabase } from './utils/supabase';
import { checkAndNotify } from './utils/notifications';
import { registerSW, triggerPushCheck, autoSubscribeIfStandalone } from './utils/pushClient';
import { cancelActivityNotifications } from './utils/activityNotifications';

import TripList from './components/TripList';
import TripDetail from './components/TripDetail';
import AuthPage from './components/AuthPage';
import InvitePage from './components/InvitePage';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState<AppPage>({ page: 'list' });

  // Register service worker once on mount
  useEffect(() => { registerSW(); }, []);

  // Detect invite link via hash: #/invite/:token
  useEffect(() => {
    function checkHash() {
      const hash = window.location.hash;
      const match = hash.match(/^#\/invite\/([^/?]+)/);
      if (match) setPage({ page: 'invite', token: match[1] });
    }
    checkHash();
    window.addEventListener('hashchange', checkHash);
    return () => window.removeEventListener('hashchange', checkHash);
  }, []);

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      if (!session) { setTrips([]); setPage({ page: 'list' }); }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    // If running as installed PWA and permission already granted, re-subscribe
    // in the correct SW context so background push works on iOS.
    autoSubscribeIfStandalone();
    setLoading(true);
    fetchTrips()
      .then((data) => { setTrips(data); checkAndNotify(data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session?.user?.id]); // stable string — not the session object (avoids re-fetch on token refresh)

  const handleCreateTrip = useCallback(async (data: Omit<Trip, 'id' | 'createdAt' | 'updatedAt'>) => {
    const now = new Date().toISOString();
    const trip: Trip = {
      id: `trip_${Date.now()}_${Math.random().toString(36).slice(2)}`,
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    await createTrip(trip);
    setTrips(prev => [trip, ...prev]);
    setPage({ page: 'trip', tripId: trip.id, tab: 'plan' });
  }, []);

  const handleDeleteTrip = useCallback(async (tripId: string) => {
    await deleteTrip(tripId);
    setTrips(prev => prev.filter(t => t.id !== tripId));
  }, []);

  const handleRefresh = useCallback(async () => {
    const data = await fetchTrips();
    setTrips(data);
    checkAndNotify(data);
  }, []);

  const handleUpdateTrip = useCallback((updated: Trip) => {
    setTrips(prev => {
      const next = prev.map(t => t.id === updated.id ? updated : t);
      checkAndNotify(next); // browser notification khi app đang mở
      return next;
    });
    // Trigger push ngay nếu ngày mới khớp 1/3/7 ngày (hoạt động kể cả khi app đóng)
    if (updated.startDate) {
      triggerPushCheck(updated.id, updated.name, updated.emoji, updated.startDate);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    cancelActivityNotifications();
    await supabase.auth.signOut();
  }, []);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 pt-safe">
        <div className="text-center">
          <div className="text-5xl mb-4">✈️</div>
          <p className="text-slate-400 text-sm">Đang tải...</p>
        </div>
      </div>
    );
  }

  if (!session) {
    // Save pending invite token so we can redirect after login
    if (page.page === 'invite') sessionStorage.setItem('pendingInvite', page.token);
    return <AuthPage />;
  }

  // After login, check for pending invite
  if (page.page === 'list') {
    const pending = sessionStorage.getItem('pendingInvite');
    if (pending) {
      sessionStorage.removeItem('pendingInvite');
      setPage({ page: 'invite', token: pending });
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50 pt-safe">
        <div className="text-center">
          <div className="text-5xl mb-4">✈️</div>
          <p className="text-slate-400 text-sm">Đang tải dữ liệu...</p>
        </div>
      </div>
    );
  }

  if (page.page === 'invite') {
    return (
      <InvitePage
        token={page.token}
        onAccepted={async (tripId) => {
          window.location.hash = '';
          const data = await fetchTrips();
          setTrips(data);
          setPage({ page: 'trip', tripId, tab: 'plan' });
        }}
        onDeclined={() => {
          window.location.hash = '';
          setPage({ page: 'list' });
        }}
      />
    );
  }

  if (page.page === 'trip') {
    const trip = trips.find(t => t.id === page.tripId);
    if (trip) {
      return (
        <TripDetail
          trip={trip}
          onBack={() => setPage({ page: 'list' })}
          onTripUpdate={handleUpdateTrip}
        />
      );
    }
  }

  return (
    <TripList
      trips={trips}
      onSelectTrip={(id) => setPage({ page: 'trip', tripId: id, tab: 'plan' })}
      onCreateTrip={handleCreateTrip}
      onDeleteTrip={handleDeleteTrip}
      onLogout={handleLogout}
      onRefresh={handleRefresh}
    />
  );
}
