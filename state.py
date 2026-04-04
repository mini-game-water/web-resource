"""Shared in-memory state and helper functions for SocketIO coordination.

All ephemeral state (not persisted — resets on server restart) lives here
so that both HTTP routes and SocketIO handlers can import it.
"""

import re
from markupsafe import escape

# ──────────────────── Ephemeral SocketIO State ────────────────────

sid_info = {}           # sid -> { user_id, room_id, context }
waiting_conns = {}      # room_id -> set of user_ids
game_conns = {}         # room_id -> set of user_ids
lobby_sids = {}         # user_id -> sid (lobby + solo + spectator connections)
spectator_conns = {}    # room_id -> set of user_ids
game_states = {}        # room_id -> cached game state for spectators
game_chats = {}         # room_id -> [{ user_id, message, timestamp }]


# ──────────────────── Utility Functions ────────────────────

def sanitize(value):
    """Strip HTML tags and escape special characters for safe output."""
    if not isinstance(value, str):
        return value
    cleaned = re.sub(r'<[^>]*>', '', value)
    return str(escape(cleaned))


def client_ip(request):
    """Extract client IP from X-Forwarded-For header or remote_addr."""
    xff = request.headers.get('X-Forwarded-For', '')
    return xff.split(',')[0].strip() if xff else request.remote_addr
