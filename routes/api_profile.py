"""Profile and account API routes."""

from flask import Blueprint, request, session, jsonify

import db
import game_logger
from state import sanitize, lobby_sids
from routes.decorators import login_required

profile_bp = Blueprint('profile', __name__)


@profile_bp.route('/api/profile', methods=['GET'])
@login_required
def get_profile():
    user = db.get_user(session['user_id'])
    if not user:
        return jsonify({'error': '사용자를 찾을 수 없습니다.'}), 404
    return jsonify({
        'user_id': user['user_id'],
        'name': user.get('name', ''),
        'email': user.get('email', ''),
        'role': user.get('role', 'user'),
    })


@profile_bp.route('/api/profile', methods=['PUT'])
@login_required
def update_profile():
    data = request.get_json()
    uid = session['user_id']
    user = db.get_user(uid)
    if not user:
        return jsonify({'error': '사용자를 찾을 수 없습니다.'}), 404

    new_id = sanitize(data.get('user_id', '').strip())
    new_pw = data.get('pw', '').strip()
    new_name = sanitize(data.get('name', '').strip())
    new_email = sanitize(data.get('email', '').strip())

    changed = []
    if new_id and new_id != uid:
        changed.append('user_id')
    if new_pw:
        changed.append('password')
    if new_name:
        changed.append('name')
    if new_email:
        changed.append('email')

    # ID change
    if new_id and new_id != uid:
        existing = db.get_user(new_id)
        if existing:
            return jsonify({'error': '이미 존재하는 아이디입니다.'}), 400
        # Create new user with same data
        new_user_data = dict(user)
        new_user_data['user_id'] = new_id
        if new_pw:
            new_user_data['pw'] = new_pw
        if new_name:
            new_user_data['name'] = new_name
        if new_email:
            new_user_data['email'] = new_email
        new_user_data.pop('public_ip', None)
        new_user_data['public_ip'] = ''
        new_user_data['status'] = 'offline'
        db.delete_user(uid)
        db._users_table.put_item(Item=new_user_data)
        session['user_id'] = new_id
        game_logger.log_profile_update(new_id, changed)
        return jsonify({'ok': True, 'new_id': new_id})

    # Update fields in place
    db.update_user_profile(
        uid,
        pw=new_pw if new_pw else None,
        name=new_name if new_name is not None else None,
        email=new_email if new_email is not None else None,
    )
    if changed:
        game_logger.log_profile_update(uid, changed)
    return jsonify({'ok': True})


@profile_bp.route('/api/account', methods=['DELETE'])
@login_required
def delete_account():
    uid = session['user_id']
    user = db.get_user(uid)
    if not user:
        return jsonify({'error': '사용자를 찾을 수 없습니다.'}), 404
    # Remove from all friends' lists
    for friend_id in user.get('friends', []):
        db.remove_friend(uid, friend_id)
        game_logger.log_friend_remove(uid, friend_id)
    # Clean up lobby presence
    if uid in lobby_sids:
        del lobby_sids[uid]
    # Delete user and log out
    game_logger.log_account_deleted(uid)
    db.delete_user(uid)
    session.clear()
    return jsonify({'ok': True})
