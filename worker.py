"""
worker.py — LiveKit Agent Worker entry point.

Deployed as a separate Render Background Worker service.
Start command: python worker.py start
"""

from livekit import agents
from voice_agent.agent import entrypoint

if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(entrypoint_fnc=entrypoint)
    )