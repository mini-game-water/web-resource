"""SocketIO handlers for the friend invite system."""

from flask_socketio import emit

import db
import game_logger
from state import sid_info, lobby_sids


def register_invite_events(socketio, app):
    """Register invite-related SocketIO event handlers."""

    @socketio.on('invite_friend')
    def on_invite_friend(data):
        rid = data['room_id']
        fid = data['friend_id']
        uid = data['user_id']
        room = db.get_room(rid)
        if not room:
            emit('invite_result', {'friend_id': fid, 'accepted': False, 'reason': '방이 존재하지 않습니다.'})
            return
        if fid not in lobby_sids:
            emit('invite_result', {'friend_id': fid, 'accepted': False, 'reason': '접속 중이 아닙니다.'})
            return
        game_logger.log_invite_sent(rid, uid, fid)
        emit('invite_received', {
            'room_id': rid,
            'room_name': room['name'],
            'game': room['game'],
            'inviter': uid
        }, to=lobby_sids[fid])

    @socketio.on('invite_response')
    def on_invite_response(data):
        rid = data['room_id']
        accepted = data['accepted']
        uid = data['user_id']
        room = db.get_room(rid)
        if not room:
            return

        # Find host's waiting sid
        host_sid = None
        for sid, info in sid_info.items():
            if info['user_id'] == room['host'] and info['context'] == 'waiting':
                host_sid = sid
                break

        game_logger.log_invite_response(rid, uid, accepted)
        if accepted and len(room.get('players', [])) < room.get('max_players', 2):
            db.join_room(rid, uid)
            game_logger.log_room_join(rid, uid)
            if host_sid:
                emit('invite_result', {'friend_id': uid, 'accepted': True}, to=host_sid)
            emit('invite_accepted', {'room_id': rid})
            from sockets.helpers import broadcast_rooms
            broadcast_rooms()
        else:
            reason = '거절됨' if not accepted else '방이 가득 찼습니다.'
            if host_sid:
                emit('invite_result', {'friend_id': uid, 'accepted': False, 'reason': reason}, to=host_sid)
            if accepted:
                emit('invite_accepted', {'error': '방이 가득 찼습니다.'})
