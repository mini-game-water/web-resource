"""
Structured event logger for Game Hub.

Buffers JSON events in memory per category and periodically flushes them
to S3 as gzipped NDJSON files, partitioned by date:

    s3://{bucket}/year=YYYY/month=MM/day=DD/{category}.json.gz

Categories: user_activity, room_activity, game_activity,
            chat_activity, friend_activity, spectate_activity
"""

import os
import io
import json
import gzip
import time
import uuid
import threading
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

BUCKET = os.environ.get('LOG_BUCKET', '')
REGION = os.environ.get('AWS_REGION', 'us-east-1')
FLUSH_INTERVAL = int(os.environ.get('LOG_FLUSH_INTERVAL', '60'))  # seconds

CATEGORIES = [
    'user_activity',
    'room_activity',
    'game_activity',
    'chat_activity',
    'friend_activity',
    'spectate_activity',
]

_buffers = {cat: [] for cat in CATEGORIES}
_lock = threading.Lock()
_s3 = None
_timer = None


def _get_s3():
    global _s3
    if _s3 is None and BUCKET:
        _s3 = boto3.client('s3', region_name=REGION)
    return _s3


def _make_event(category, event_type, **kwargs):
    """Create a structured log event dict."""
    evt = {
        'event_id': uuid.uuid4().hex,
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'epoch_ms': int(time.time() * 1000),
        'category': category,
        'event_type': event_type,
    }
    evt.update(kwargs)
    return evt


def log(category, event_type, **kwargs):
    """Buffer a structured log event."""
    if category not in _buffers:
        return
    evt = _make_event(category, event_type, **kwargs)
    with _lock:
        _buffers[category].append(evt)


def flush():
    """Flush all buffered events to S3 (or stdout if no bucket configured)."""
    now = datetime.now(timezone.utc)
    prefix = f"year={now.year}/month={now.month:02d}/day={now.day:02d}"

    with _lock:
        snapshot = {cat: list(evts) for cat, evts in _buffers.items()}
        for cat in _buffers:
            _buffers[cat] = []

    s3 = _get_s3()

    for cat, events in snapshot.items():
        if not events:
            continue

        ndjson = '\n'.join(json.dumps(e, ensure_ascii=False) for e in events) + '\n'
        gz_buf = io.BytesIO()
        with gzip.GzipFile(fileobj=gz_buf, mode='wb') as gz:
            gz.write(ndjson.encode('utf-8'))
        gz_bytes = gz_buf.getvalue()

        if s3 and BUCKET:
            # Append unique suffix to avoid overwrites within same flush interval
            suffix = uuid.uuid4().hex[:8]
            key = f"{cat}/{prefix}/{cat}-{suffix}.json.gz"
            try:
                s3.put_object(
                    Bucket=BUCKET,
                    Key=key,
                    Body=gz_bytes,
                    ContentType='application/x-ndjson',
                    ContentEncoding='gzip',
                )
            except ClientError:
                pass  # Best-effort logging — don't crash the app
        else:
            # Local dev: print events to stdout
            for e in events:
                print(f"[LOG:{cat}] {json.dumps(e, ensure_ascii=False)}")


def _periodic_flush():
    """Background timer that flushes every FLUSH_INTERVAL seconds."""
    global _timer
    flush()
    _timer = threading.Timer(FLUSH_INTERVAL, _periodic_flush)
    _timer.daemon = True
    _timer.start()


def init():
    """Start the periodic flush timer. Call once at app startup."""
    global _timer
    if _timer is not None:
        return
    _timer = threading.Timer(FLUSH_INTERVAL, _periodic_flush)
    _timer.daemon = True
    _timer.start()


# ──────────────── Convenience logging functions ────────────────

# User activity
def log_login(user_id, ip):
    log('user_activity', 'login', user_id=user_id, ip=ip)

def log_logout(user_id):
    log('user_activity', 'logout', user_id=user_id)

def log_register(user_id):
    log('user_activity', 'register', user_id=user_id)

def log_status_change(user_id, old_status, new_status):
    log('user_activity', 'status_change', user_id=user_id,
        old_status=old_status, new_status=new_status)

def log_profile_update(user_id, fields_changed):
    log('user_activity', 'profile_update', user_id=user_id,
        fields_changed=fields_changed)

# Room activity
def log_room_create(room_id, host, game, max_players, allow_spectate, allow_coaching):
    log('room_activity', 'room_create', room_id=room_id, host=host,
        game=game, max_players=max_players,
        allow_spectate=allow_spectate, allow_coaching=allow_coaching)

def log_room_join(room_id, user_id):
    log('room_activity', 'room_join', room_id=room_id, user_id=user_id)

def log_room_leave(room_id, user_id, reason='disconnect'):
    log('room_activity', 'room_leave', room_id=room_id, user_id=user_id,
        reason=reason)

def log_room_delete(room_id, reason='empty'):
    log('room_activity', 'room_delete', room_id=room_id, reason=reason)

def log_game_start(room_id, game, players, forced=False):
    log('room_activity', 'game_start', room_id=room_id, game=game,
        players=players, forced=forced)

def log_room_host_transfer(room_id, old_host, new_host):
    log('room_activity', 'host_transfer', room_id=room_id,
        old_host=old_host, new_host=new_host)

def log_poker_mid_join(room_id, user_id):
    log('room_activity', 'poker_mid_join', room_id=room_id, user_id=user_id)

# Game activity
def log_game_move(room_id, user_id, game, move_data=None):
    log('game_activity', 'game_move', room_id=room_id, user_id=user_id,
        game=game, move_data=move_data)

def log_game_over(room_id, game, winner=None, loser=None, scores=None):
    log('game_activity', 'game_over', room_id=room_id, game=game,
        winner=winner, loser=loser, scores=scores)

def log_player_eliminated(room_id, game, user_id):
    log('game_activity', 'player_eliminated', room_id=room_id, game=game,
        user_id=user_id)

def log_tetris_state(room_id, user_id, score, level, lines):
    log('game_activity', 'tetris_state', room_id=room_id, user_id=user_id,
        score=score, level=level, lines=lines)

def log_poker_hand(room_id, hand_data=None):
    log('game_activity', 'poker_hand', room_id=room_id, hand_data=hand_data)

# Chat activity
def log_chat(room_id, user_id, role, message):
    log('chat_activity', 'chat_message', room_id=room_id, user_id=user_id,
        role=role, message=message)

# Friend activity
def log_friend_add(user_id, friend_id):
    log('friend_activity', 'friend_add', user_id=user_id, friend_id=friend_id)

def log_invite_sent(room_id, inviter, invitee):
    log('friend_activity', 'invite_sent', room_id=room_id,
        inviter=inviter, invitee=invitee)

def log_invite_response(room_id, user_id, accepted):
    log('friend_activity', 'invite_response', room_id=room_id,
        user_id=user_id, accepted=accepted)

# Spectate activity
def log_spectate_join(room_id, user_id):
    log('spectate_activity', 'spectate_join', room_id=room_id, user_id=user_id)

def log_spectate_leave(room_id, user_id):
    log('spectate_activity', 'spectate_leave', room_id=room_id, user_id=user_id)

def log_coaching(room_id, user_id, game):
    log('spectate_activity', 'coaching_suggest', room_id=room_id,
        user_id=user_id, game=game)

def log_coaching_clear(room_id, user_id):
    log('spectate_activity', 'coaching_clear', room_id=room_id, user_id=user_id)
