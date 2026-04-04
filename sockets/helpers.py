"""Shared SocketIO helper functions used by both routes and socket handlers."""

from flask import current_app

import db
from state import spectator_conns, game_conns, game_chats, game_states


def get_socketio():
    """Get the SocketIO instance from the current Flask app."""
    return current_app.extensions['socketio']


def broadcast_rooms():
    """Broadcast updated room list to all lobby clients."""
    socketio = get_socketio()
    waiting = db.list_waiting_rooms()
    room_list = [{
        'id': r['room_id'], 'name': r['name'], 'game': r['game'],
        'password': bool(r.get('password')), 'host': r['host'],
        'player_count': len(r.get('players', [])), 'max_players': r.get('max_players', 2),
        'mode': 'waiting'
    } for r in waiting]
    spectatable = db.list_spectatable_rooms()
    room_list += [{
        'id': r['room_id'], 'name': r['name'], 'game': r['game'],
        'password': False, 'host': r['host'],
        'player_count': len(r.get('players', [])), 'max_players': r.get('max_players', 2),
        'mode': 'spectate',
        'spectator_count': len(spectator_conns.get(r['room_id'], set()))
    } for r in spectatable]
    socketio.emit('rooms_updated', {'rooms': room_list}, room='lobby')


def broadcast_friend_status(user_id, status, public_ip=''):
    """Broadcast a user's status change to all lobby clients."""
    socketio = get_socketio()
    socketio.emit('friend_status_changed', {
        'id': user_id, 'status': status, 'public_ip': public_ip
    }, room='lobby')


def broadcast_participants(rid):
    """Broadcast current player and spectator list to a game room."""
    socketio = get_socketio()
    players = list(game_conns.get(rid, set()))
    spectators = list(spectator_conns.get(rid, set()))
    socketio.emit('participants_update', {
        'players': players,
        'spectators': spectators,
    }, room=rid)


def destroy_game_room(rid):
    """Delete room from DB, kick spectators, clean up in-memory state."""
    socketio = get_socketio()
    socketio.emit('room_destroyed', {}, room=rid)
    import game_logger
    game_logger.log_room_delete(rid, reason='all_left')
    db.delete_room(rid)
    game_conns.pop(rid, None)
    game_chats.pop(rid, None)
    game_states.pop(rid, None)
    spectator_conns.pop(rid, None)
    broadcast_rooms()
