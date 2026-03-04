#!/bin/bash
set -e

echo "🚀 Starting Voice Agent Worker..."
python voice_agent/worker.py &
VOICE_AGENT_PID=$!

echo "🌐 Starting FastAPI Backend..."
uvicorn main:app --host 0.0.0.0 --port 8080 &
FASTAPI_PID=$!

# ── Health check loop ─────────────────────────────────────────
echo "✅ Both services started. Monitoring..."
echo "   Voice Agent PID: $VOICE_AGENT_PID"
echo "   FastAPI PID:     $FASTAPI_PID"

# If either process dies, kill the other and exit
wait -n $VOICE_AGENT_PID $FASTAPI_PID
EXIT_CODE=$?

echo "⚠️  One service exited with code $EXIT_CODE. Shutting down..."
kill $VOICE_AGENT_PID $FASTAPI_PID 2>/dev/null
exit $EXIT_CODE