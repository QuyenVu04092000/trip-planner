#!/bin/bash
# Chạy: bash test-push.sh
# Trigger Edge Function để gửi push notification (cron mode)

curl -s -X GET \
  "https://ykrxbyvjxmnqvqawlwyx.supabase.co/functions/v1/trip-push-notify" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlrcnhieXZqeG1ucXZxYXdsd3l4Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTg2MjEzOSwiZXhwIjoyMDk1NDM4MTM5fQ.-t0OD2fdkbHdf2W_UrsqZG2zgVwRUUHOMZWS9x69Qng" \
  -H "Content-Type: application/json" \
  -w "\nHTTP %{http_code}\n"
