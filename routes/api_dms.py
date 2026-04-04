"""Direct messaging API routes."""

from flask import Blueprint, request, session, jsonify

import db
import game_logger
from state import lobby_sids
from routes.decorators import login_required
from sockets.helpers import get_socketio

dms_bp = Blueprint('dms', __name__)


@dms_bp.route('/api/dms/send', methods=['POST'])
@login_required
def dm_send():
    uid = session['user_id']
    data = request.get_json() or {}
    recipient = data.get('recipient_id', '').strip()
    message = data.get('message', '').strip()
    if not recipient or not message:
        return jsonify({'error': '수신자와 메시지를 입력하세요.'}), 400
    if len(message) > 500:
        return jsonify({'error': '메시지는 500자 이내로 입력하세요.'}), 400
    # Verify friendship
    user = db.get_user(uid)
    if not user or recipient not in user.get('friends', []):
        return jsonify({'error': '친구만 메시지를 보낼 수 있습니다.'}), 403
    dm = db.send_dm(uid, recipient, message)
    conv_id = db.make_conversation_id(uid, recipient)
    game_logger.log_dm_sent(uid, recipient, conv_id, message=message)
    # Real-time delivery if recipient is online
    if recipient in lobby_sids:
        socketio = get_socketio()
        socketio.emit('dm_received', {
            'sender_id': uid,
            'message': message,
            'timestamp': dm['timestamp'],
            'conversation_id': conv_id,
        }, room=lobby_sids[recipient])
    return jsonify({'ok': True, 'dm': dm})


@dms_bp.route('/api/dms/<friend_id>', methods=['GET'])
@login_required
def dm_conversation(friend_id):
    uid = session['user_id']
    messages, last_key = db.get_conversation(uid, friend_id)
    return jsonify({'messages': messages, 'last_key': last_key})


@dms_bp.route('/api/dms/<friend_id>/read', methods=['POST'])
@login_required
def dm_mark_read(friend_id):
    uid = session['user_id']
    db.mark_as_read(uid, friend_id, uid)
    conv_id = '#'.join(sorted([uid, friend_id]))
    game_logger.log_dm_read(uid, conv_id)
    # Notify sender that messages were read
    if friend_id in lobby_sids:
        socketio = get_socketio()
        socketio.emit('dm_read', {
            'reader_id': uid,
            'conversation_id': db.make_conversation_id(uid, friend_id),
        }, room=lobby_sids[friend_id])
    return jsonify({'ok': True})


@dms_bp.route('/api/dms/unread', methods=['GET'])
@login_required
def dm_unread():
    uid = session['user_id']
    counts = db.get_unread_counts(uid)
    return jsonify({'counts': counts})
