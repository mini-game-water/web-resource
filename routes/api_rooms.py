"""Room API routes: create, join, join-game (poker mid-join), force-close."""

import uuid
import os

from flask import Blueprint, request, session, jsonify

import db
import game_logger
from state import sanitize, lobby_sids, game_conns, game_chats, game_states, spectator_conns, waiting_conns
from routes.decorators import login_required, admin_required
from sockets.helpers import broadcast_rooms, broadcast_friend_status

rooms_bp = Blueprint('rooms', __name__)


@rooms_bp.route('/api/rooms', methods=['POST'])
@login_required
def create_room():
    data = request.get_json()
    rid = uuid.uuid4().hex[:8]
    game = data.get('game', 'tetris')
    max_players = int(data.get('max_players', 2))
    if game == 'tetris':
        max_players = max(2, min(8, max_players))
    elif game == 'yacht':
        max_players = max(2, min(4, max_players))
    elif game == 'poker':
        max_players = max(2, min(6, max_players))
    else:
        max_players = 2
    allow_spectate = bool(data.get('allow_spectate'))
    allow_coaching = bool(data.get('allow_coaching'))
    db.create_room(
        room_id=rid,
        name=sanitize(data.get('name', 'Untitled')),
        game=game,
        password=data.get('password', ''),
        host=session['user_id'],
        max_players=max_players,
        allow_spectate=allow_spectate,
        allow_coaching=allow_coaching,
    )
    game_logger.log_room_create(rid, session['user_id'], game, max_players,
                                allow_spectate, allow_coaching)
    broadcast_rooms()
    return jsonify({'room_id': rid})


@rooms_bp.route('/api/rooms/<room_id>/join', methods=['POST'])
@login_required
def join_room_api(room_id):
    room = db.get_room(room_id)
    if not room:
        return jsonify({'error': '방을 찾을 수 없습니다.'}), 404
    if room.get('password'):
        pw = (request.get_json() or {}).get('password', '')
        if pw != room['password']:
            return jsonify({'error': '비밀번호가 틀립니다.'}), 403
    if len(room.get('players', [])) >= room.get('max_players', 2):
        return jsonify({'error': '방이 가득 찼습니다.'}), 400
    uid = session['user_id']
    db.join_room(room_id, uid)
    game_logger.log_room_join(room_id, uid)
    broadcast_rooms()
    return jsonify({'room_id': room_id})


@rooms_bp.route('/api/rooms/<room_id>/join-game', methods=['POST'])
@login_required
def join_game_api(room_id):
    """Allow joining a poker game that's already in progress."""
    room = db.get_room(room_id)
    if not room:
        return jsonify({'error': '방을 찾을 수 없습니다.'}), 404
    if room.get('game') != 'poker':
        return jsonify({'error': '포커 방만 중간 참여 가능합니다.'}), 400
    if room.get('password'):
        pw = (request.get_json() or {}).get('password', '')
        if pw != room['password']:
            return jsonify({'error': '비밀번호가 틀립니다.'}), 403
    uid = session['user_id']
    if uid in room.get('players', []):
        return jsonify({'room_id': room_id})
    if len(room.get('players', [])) >= room.get('max_players', 6):
        return jsonify({'error': '방이 가득 찼습니다.'}), 400
    db.join_room(room_id, uid)
    game_logger.log_poker_mid_join(room_id, uid)
    broadcast_rooms()
    return jsonify({'room_id': room_id, 'joining_mid_game': True})


@rooms_bp.route('/api/rooms/<room_id>/force-close', methods=['POST'])
@admin_required
def force_close_room(room_id):
    from flask_socketio import SocketIO
    from flask import current_app
    socketio = current_app.extensions['socketio']

    room = db.get_room(room_id)
    if not room:
        return jsonify({'error': '방을 찾을 수 없습니다.'}), 404
    socketio.emit('room_force_closed', {'message': '관리자에 의해 방이 강제 종료되었습니다.'}, room=room_id)
    game_logger.log_room_delete(room_id, reason='admin_force_close')
    # Restore all affected players' and spectators' statuses to 'online'
    for uid in room.get('players', []):
        db.update_user_status(uid, 'online')
        broadcast_friend_status(uid, 'online')
    if room_id in spectator_conns:
        for uid in spectator_conns[room_id]:
            db.update_user_status(uid, 'online')
            broadcast_friend_status(uid, 'online')
    db.delete_room(room_id)
    game_conns.pop(room_id, None)
    game_chats.pop(room_id, None)
    game_states.pop(room_id, None)
    spectator_conns.pop(room_id, None)
    waiting_conns.pop(room_id, None)
    broadcast_rooms()
    return jsonify({'ok': True})
