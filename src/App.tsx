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

// ── Hash helpers ──────────────────────────────────────────────────────────────

function hashFromPage(page: AppPage): string {
  if (page.page === 'trip')   return `#/trip/${page.tripId}/${page.tab}`;
  if (page.page === 'invite') return `#/invite/${page.token}`;
  return '#/';
}

function pageFromHash(hash: string): AppPage | null {
  const invite = hash.match(/^#\/invite\/([^/?]+)/);
  if (invite) return { page: 'invite', token: invite[1] };

  const trip = hash.match(/^#\/trip\/([^/]+)\/([^/]+)/);
  if (trip) {
    const tab = trip[2];
    const validTab = ['plan', 'memory', 'expense'].includes(tab) ? tab : 'plan';
    return { page: 'trip', tripId: trip[1], tab: validTab as 'plan' | 'memory' | 'expense' };
  }
  return null;
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [session, setSession]       = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [trips, setTrips]           = useState<Trip[]>([]);
  const [loading, setLoading]       = useState(true);
  const [page, setPageState]        = useState<AppPage>(() => pageFromHash(window.location.hash) ?? { page: 'list' });

  // Keep hash in sync whenever page changes
  const setPage = useCallback((next: AppPage) => {
    setPageState(next);
    const hash = hashFromPage(next);
    if (window.location.hash !== hash) window.location.hash = hash;
  }, []);

  // Register service worker once on mount
  useEffect(() => { registerSW(); }, []);

  // Sync page when user presses browser Back/Forward
  useEffect(() => {
    function onHashChange() {
      const next = pageFromHash(window.location.hash);
      if (next) setPageState(next);
      else setPageState({ page: 'list' });
    }
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Auth state
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      if (!session) { setTrips([]); setPageState({ page: 'list' }); window.location.hash = '#/'; }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    autoSubscribeIfStandalone();
    setLoading(true);
    fetchTrips()
      .then((data) => { setTrips(data); checkAndNotify(data); })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [session?.user?.id]);

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
  }, [setPage]);

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
      checkAndNotify(next);
      return next;
    });
    if (updated.startDate) {
      triggerPushCheck(updated.id, updated.name, updated.emoji, updated.startDate);
    }
  }, []);

  const handleLogout = useCallback(async () => {
    cancelActivityNotifications();
    await supabase.auth.signOut();
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────

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
          const data = await fetchTrips();
          setTrips(data);
          setPage({ page: 'trip', tripId, tab: 'plan' });
        }}
        onDeclined={() => setPage({ page: 'list' })}
      />
    );
  }

  if (page.page === 'trip') {
    const trip = trips.find(t => t.id === page.tripId);
    if (trip) {
      return (
        <TripDetail
          trip={trip}
          initialTab={page.tab}
          onBack={() => setPage({ page: 'list' })}
          onTabChange={(tab) => setPage({ page: 'trip', tripId: trip.id, tab })}
          onTripUpdate={handleUpdateTrip}
        />
      );
    }
  }

  return (
    <TripList
      trips={trips}
      userEmail={session.user.email ?? ''}
      onSelectTrip={(id) => setPage({ page: 'trip', tripId: id, tab: 'plan' })}
      onCreateTrip={handleCreateTrip}
      onDeleteTrip={handleDeleteTrip}
      onLogout={handleLogout}
      onRefresh={handleRefresh}
    />
  );
}
