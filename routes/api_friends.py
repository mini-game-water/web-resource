"""Friend API routes: request, accept, reject, pending."""

from flask import Blueprint, request, session, jsonify

import db
import game_logger
from state import sanitize, lobby_sids
from routes.decorators import login_required
from sockets.helpers import get_socketio

friends_bp = Blueprint('friends', __name__)


@friends_bp.route('/api/friends/request', methods=['POST'])
@login_required
def friend_request():
    data = request.get_json()
    fid = sanitize(data.get('friend_id', '').strip())
    uid = session['user_id']
    if fid == uid:
        return jsonify({'error': '자기 자신은 추가할 수 없습니다.'}), 400
    friend = db.get_user(fid)
    if not friend:
        return jsonify({'error': '사용자를 찾을 수 없습니다.'}), 404
    # Already friends?
    user = db.get_user(uid) or {}
    if fid in user.get('friends', []):
        return jsonify({'error': '이미 친구입니다.'}), 400
    # Check if they already sent us a request → auto-accept
    my_requests = db.get_friend_requests(uid)
    if fid in my_requests:
        db.remove_friend_request(uid, fid)
        db.add_friend(uid, fid)
        game_logger.log_friend_add(uid, fid)
        socketio = get_socketio()
        if fid in lobby_sids:
            socketio.emit('friend_request_accepted', {'from': uid}, room=lobby_sids[fid])
        return jsonify({'ok': True, 'message': f'{fid}님과 친구가 되었습니다! (상대방도 요청을 보낸 상태였습니다)'})
    ok = db.send_friend_request(uid, fid)
    if not ok:
        return jsonify({'error': '이미 친구 요청을 보냈습니다.'}), 400
    # Real-time notification
    socketio = get_socketio()
    if fid in lobby_sids:
        socketio.emit('friend_request_received', {'from': uid}, room=lobby_sids[fid])
    return jsonify({'ok': True, 'message': f'{fid}님에게 친구 요청을 보냈습니다.'})


@friends_bp.route('/api/friends/accept', methods=['POST'])
@login_required
def friend_accept():
    data = request.get_json()
    fid = sanitize(data.get('friend_id', '').strip())
    uid = session['user_id']
    # Verify request exists
    requests_list = db.get_friend_requests(uid)
    if fid not in requests_list:
        return jsonify({'error': '해당 친구 요청이 없습니다.'}), 404
    db.remove_friend_request(uid, fid)
    db.add_friend(uid, fid)
    game_logger.log_friend_add(uid, fid)
    # Notify requester in real-time
    socketio = get_socketio()
    if fid in lobby_sids:
        socketio.emit('friend_request_accepted', {'from': uid}, room=lobby_sids[fid])
    return jsonify({'ok': True})


@friends_bp.route('/api/friends/reject', methods=['POST'])
@login_required
def friend_reject():
    data = request.get_json()
    fid = sanitize(data.get('friend_id', '').strip())
    uid = session['user_id']
    db.remove_friend_request(uid, fid)
    game_logger.log_friend_request_rejected(uid, fid)
    return jsonify({'ok': True})


@friends_bp.route('/api/friends/pending', methods=['GET'])
@login_required
def friend_pending():
    uid = session['user_id']
    requests_list = db.get_friend_requests(uid)
    return jsonify({'requests': requests_list})
