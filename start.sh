#!/bin/bash
set -e

echo "🚀 Starting Voice Agent Worker..."
python voice_agent/worker.py &
VOICE_AGENT_PID=$!

echo "🌐 Starting FastAPI Backend..."
uvicorn main:app --host 0.0.0.0 --port 8080 &
FASTAPI_PID=$!

echo "✅ Both services started. Monitoring..."
echo "   Voice Agent PID: $VOICE_AGENT_PID"
echo "   FastAPI PID:     $FASTAPI_PID"

# Compatible with all bash versions
wait $VOICE_AGENT_PID
wait $FASTAPI_PID