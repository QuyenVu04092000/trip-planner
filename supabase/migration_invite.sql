-- ── 1. trip_members ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_members (
  id          TEXT        PRIMARY KEY,
  trip_id     TEXT        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL,
  user_email  TEXT        NOT NULL,
  role        TEXT        NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(trip_id, user_id)
);

ALTER TABLE trip_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_members_select" ON trip_members FOR SELECT
  USING (
    trip_id IN (
      SELECT id FROM trips WHERE user_id = auth.uid()
      UNION
      SELECT trip_id FROM trip_members WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "trip_members_insert" ON trip_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "trip_members_delete" ON trip_members FOR DELETE
  USING (
    user_id = auth.uid()
    OR trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())
  );

-- ── 2. trip_invites ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trip_invites (
  id              TEXT        PRIMARY KEY,
  trip_id         TEXT        NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  token           TEXT        NOT NULL UNIQUE,
  created_by      UUID        NOT NULL,
  trip_name       TEXT        NOT NULL,
  trip_emoji      TEXT        NOT NULL DEFAULT '✈️',
  owner_email     TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active','expired')),
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trip_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trip_invites_select" ON trip_invites FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "trip_invites_insert" ON trip_invites FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid())
  );

CREATE POLICY "trip_invites_update" ON trip_invites FOR UPDATE
  USING (trip_id IN (SELECT id FROM trips WHERE user_id = auth.uid()));

-- ── 3. Trips: thêm policy cho member ─────────────────────────────────────────
CREATE POLICY "trips_member_select" ON trips FOR SELECT
  USING (id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid()));

-- ── 4. Activities: thêm policy cho member ────────────────────────────────────
CREATE POLICY "activities_member_all" ON activities FOR ALL
  USING (trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid()))
  WITH CHECK (trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid()));

-- ── 5. Media items: thêm policy cho member ───────────────────────────────────
CREATE POLICY "media_items_member_all" ON media_items FOR ALL
  USING (trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid()))
  WITH CHECK (trip_id IN (SELECT trip_id FROM trip_members WHERE user_id = auth.uid()));

-- ── 6. Backfill: thêm owner hiện tại vào trip_members ────────────────────────
INSERT INTO trip_members (id, trip_id, user_id, user_email, role, joined_at)
SELECT
  'mem_' || FLOOR(EXTRACT(EPOCH FROM t.created_at))::TEXT || '_' || SUBSTRING(t.id FROM 6),
  t.id,
  t.user_id,
  COALESCE(u.email, ''),
  'owner',
  t.created_at
FROM trips t
JOIN auth.users u ON t.user_id = u.id
WHERE t.user_id IS NOT NULL
ON CONFLICT (trip_id, user_id) DO NOTHING;
