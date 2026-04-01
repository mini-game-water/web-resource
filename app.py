import os
import uuid
import time
import random
from functools import wraps

import re
from markupsafe import escape

from flask import Flask, render_template, request, redirect, url_for, session, jsonify, Response
from flask_wtf.csrf import CSRFProtect
from flask_socketio import SocketIO, emit, join_room, leave_room

import boto3
import db
import game_logger

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'game-hub-dev-secret-key')
app.config['WTF_CSRF_CHECK_DEFAULT'] = False
csrf = CSRFProtect(app)
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins='*',
                    logger=True, engineio_logger=True)


@app.before_request
def csrf_protect_non_socketio():
    """Apply CSRF protection to all routes except Socket.IO polling transport."""
    if request.path.startswith('/socket.io'):
        return
    csrf.protect()


# ──────────────────── XSS Sanitizer ────────────────────

def sanitize(value):
    """Strip HTML tags and escape special characters for safe output."""
    if not isinstance(value, str):
        return value
    cleaned = re.sub(r'<[^>]*>', '', value)
    return str(escape(cleaned))

game_logger.init()

# In-memory state (ephemeral SocketIO connection tracking — not persisted)
sid_info = {}
waiting_conns = {}
game_conns = {}
lobby_sids = {}  # user_id -> sid (index page + spectator connections)
spectator_conns = {}  # room_id -> set of user_ids
game_states = {}  # room_id -> cached game state for spectators
game_chats = {}  # room_id -> [{ user_id, message, timestamp }]


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper


def admin_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return jsonify({'error': '로그인이 필요합니다.'}), 401
        user = db.get_user(session['user_id'])
        if not user or user.get('role') != 'admin':
            return jsonify({'error': '관리자 권한이 필요합니다.'}), 403
        return f(*args, **kwargs)
    return wrapper


def client_ip():
    xff = request.headers.get('X-Forwarded-For', '')
    return xff.split(',')[0].strip() if xff else request.remote_addr


@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'socketio': 'enabled',
                    'cors': app.config.get('WTF_CSRF_CHECK_DEFAULT', True)})


# ──────────────────── Broadcast Helpers ────────────────────

def broadcast_rooms():
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
    socketio.emit('friend_status_changed', {
        'id': user_id, 'status': status, 'public_ip': public_ip
    }, room='lobby')


# ──────────────────── Error Handlers ────────────────────

@app.errorhandler(404)
def page_not_found(e):
    return render_template('error.html', error_code=404,
                           error_title='페이지를 찾을 수 없습니다',
                           error_desc='요청하신 페이지가 존재하지 않거나 이동되었습니다.'), 404

@app.errorhandler(500)
def internal_error(e):
    return render_template('error.html', error_code=500,
                           error_title='서버 오류가 발생했습니다',
                           error_desc='일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.'), 500

@app.errorhandler(403)
def forbidden(e):
    return render_template('error.html', error_code=403,
                           error_title='접근이 거부되었습니다',
                           error_desc='이 페이지에 접근할 권한이 없습니다.'), 403


# ──────────────────── Auth ────────────────────

@app.route('/login', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        uid = request.form.get('user_id', '').strip()
        pw = request.form.get('password', '')
        user = db.get_user(uid)
        if user and user['pw'] == pw:
            session['user_id'] = uid
            ip = client_ip()
            db.update_user_login(uid, ip)
            game_logger.log_login(uid, ip)
            return redirect(url_for('index'))
        error = '아이디 또는 비밀번호가 올바르지 않습니다.'
    return render_template('login.html', error=error)


@app.route('/register', methods=['POST'])
def register():
    uid = sanitize(request.form.get('user_id', '').strip())
    pw = request.form.get('password', '')
    name = sanitize(request.form.get('name', '').strip())
    email = sanitize(request.form.get('email', '').strip())
    if not uid or not pw:
        return render_template('login.html', error='아이디 또는 비밀번호를 확인해 주세요.', show_register=True)
    if not name or not email:
        return render_template('login.html', error='이름과 이메일은 필수 입력 항목입니다.', show_register=True)
    if not db.create_user(uid, pw, name=name, email=email):
        return render_template('login.html', error='이미 존재하는 아이디입니다.', show_register=True)
    game_logger.log_register(uid)
    return render_template('login.html', success='회원가입 성공! 로그인해 주세요.')


@app.route('/logout')
@login_required
def logout():
    uid = session.pop('user_id', None)
    if uid:
        db.update_user_logout(uid)
        game_logger.log_logout(uid)
    return redirect(url_for('login'))


# ──────────────────── Pages ────────────────────

@app.route('/')
@login_required
def index():
    uid = session['user_id']
    game_logger.log_page_view(uid, 'index', user_agent=request.headers.get('User-Agent', ''),
                              referrer=request.referrer)
    user = db.get_user(uid) or {}
    my_ip = user.get('public_ip', '')

    friend_ids = user.get('friends', [])
    friends_data = db.batch_get_users(friend_ids)
    friends = []
    for fid in friend_ids:
        f = friends_data.get(fid)
        if f:
            friends.append({
                'id': fid,
                'score': f.get('score', 0),
                'status': f.get('status', 'offline'),
                'nearby': bool(my_ip and f.get('public_ip') == my_ip)
            })

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

    notices = db.list_notices()
    is_admin = user.get('role') == 'admin'
    friend_requests = user.get('friend_requests', [])
    return render_template('index.html', user_id=uid, user=user, friends=friends,
                           rooms=room_list, notices=notices, is_admin=is_admin,
                           friend_requests=friend_requests)


@app.route('/room/<room_id>')
@login_required
def room_page(room_id):
    game_logger.log_page_view(session['user_id'], 'room', room_id=room_id,
                              user_agent=request.headers.get('User-Agent', ''))
    room = db.get_room(room_id)
    if not room:
        return render_template('room_not_found.html'), 404
    if session['user_id'] not in room.get('players', []):
        return redirect(url_for('index'))

    # If room is already playing, redirect straight to the game page
    if room.get('status') == 'playing':
        game = room.get('game', 'tetris')
        return redirect(f'/{game}?room_id={room_id}')

    uid = session['user_id']
    # Set status to 'waiting' immediately so lobby disconnect doesn't flash 'offline'
    db.update_user_status(uid, 'waiting')
    user = db.get_user(uid) or {}
    friend_ids = user.get('friends', [])
    friends_data = db.batch_get_users(friend_ids)
    friends = []
    for fid in friend_ids:
        f = friends_data.get(fid)
        if f:
            friends.append({
                'id': fid,
                'status': f.get('status', 'offline')
            })
    return render_template('room.html', room=room, user_id=uid, friends=friends)


def _game_route(template):
    room_id = request.args.get('room_id', '')
    room = db.get_room(room_id) if room_id else None
    is_spectator = request.args.get('spectate') == '1'
    game_name = template.replace('.html', '')
    game_logger.log_page_view(session['user_id'], game_name, room_id=room_id or None,
                              game=game_name, user_agent=request.headers.get('User-Agent', ''))
    uid = session['user_id']
    new_status = 'spectating' if is_spectator else ('practicing' if not room_id else 'ingame')
    db.update_user_status(uid, new_status)
    broadcast_friend_status(uid, new_status)
    my_player = None
    if room_id and not room:
        return render_template('room_not_found.html'), 404
    if room and not is_spectator and session['user_id'] in room.get('players', []):
        my_player = room['players'].index(session['user_id']) + 1
    elif room and is_spectator and not room.get('allow_spectate'):
        return redirect(url_for('index'))
    return render_template(template, room_id=room_id, room=room,
                           my_player=my_player, user_id=session['user_id'],
                           is_spectator=is_spectator)


@app.route('/tetris')
@login_required
def tetris():
    return _game_route('tetris.html')


@app.route('/omok')
@login_required
def omok():
    return _game_route('omok.html')


@app.route('/chess')
@login_required
def chess():
    return _game_route('chess.html')


@app.route('/yacht')
@login_required
def yacht():
    return _game_route('yacht.html')


@app.route('/poker')
@login_required
def poker():
    return _game_route('poker.html')


@app.route('/rummikub')
@login_required
def rummikub():
    return _game_route('rummikub.html')


@app.route('/bang')
@login_required
def bang():
    return _game_route('bang.html')


@app.route('/splendor')
@login_required
def splendor():
    return _game_route('splendor.html')


@app.route('/halligalli')
@login_required
def halligalli():
    return _game_route('halligalli.html')


# ──────────────────── Room API ────────────────────

@app.route('/api/rooms', methods=['POST'])
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


@app.route('/api/rooms/<room_id>/join', methods=['POST'])
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


@app.route('/api/rooms/<room_id>/join-game', methods=['POST'])
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


@app.route('/api/friends/request', methods=['POST'])
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
        if fid in lobby_sids:
            socketio.emit('friend_request_accepted', {'from': uid}, room=lobby_sids[fid])
        return jsonify({'ok': True, 'message': f'{fid}님과 친구가 되었습니다! (상대방도 요청을 보낸 상태였습니다)'})
    ok = db.send_friend_request(uid, fid)
    if not ok:
        return jsonify({'error': '이미 친구 요청을 보냈습니다.'}), 400
    # Real-time notification
    if fid in lobby_sids:
        socketio.emit('friend_request_received', {'from': uid}, room=lobby_sids[fid])
    return jsonify({'ok': True, 'message': f'{fid}님에게 친구 요청을 보냈습니다.'})


@app.route('/api/friends/accept', methods=['POST'])
@login_required
def friend_accept():
    data = request.get_json()
    fid = sanitize(data.get('friend_id', '').strip())
    uid = session['user_id']
    # Verify request exists
    requests = db.get_friend_requests(uid)
    if fid not in requests:
        return jsonify({'error': '해당 친구 요청이 없습니다.'}), 404
    db.remove_friend_request(uid, fid)
    db.add_friend(uid, fid)
    game_logger.log_friend_add(uid, fid)
    # Notify requester in real-time
    if fid in lobby_sids:
        socketio.emit('friend_request_accepted', {'from': uid}, room=lobby_sids[fid])
    return jsonify({'ok': True})


@app.route('/api/friends/reject', methods=['POST'])
@login_required
def friend_reject():
    data = request.get_json()
    fid = sanitize(data.get('friend_id', '').strip())
    uid = session['user_id']
    db.remove_friend_request(uid, fid)
    game_logger.log_friend_request_rejected(uid, fid)
    return jsonify({'ok': True})


@app.route('/api/friends/pending', methods=['GET'])
@login_required
def friend_pending():
    uid = session['user_id']
    requests = db.get_friend_requests(uid)
    return jsonify({'requests': requests})


# ──────────────────── Profile API ────────────────────

@app.route('/api/profile', methods=['GET'])
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


@app.route('/api/profile', methods=['PUT'])
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


@app.route('/api/account', methods=['DELETE'])
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


# ──────────────────── Notice API ────────────────────

@app.route('/api/notices', methods=['GET'])
@login_required
def get_notices():
    notices = db.list_notices()
    return jsonify({'notices': notices})


@app.route('/api/notices', methods=['POST'])
@admin_required
def post_notice():
    data = request.get_json()
    title = sanitize((data.get('title') or '').strip())
    content = sanitize((data.get('content') or '').strip())
    if not title:
        return jsonify({'error': '제목을 입력하세요.'}), 400
    image_url = (data.get('image_url') or '').strip()
    notice_id = db.create_notice(session['user_id'], title, content, image_url=image_url)
    game_logger.log_notice_created(session['user_id'], notice_id, title)
    notice = {
        'notice_id': notice_id,
        'author': session['user_id'],
        'title': title,
        'content': content,
        'image_url': image_url,
        'created_at': int(time.time()),
    }
    socketio.emit('notice_posted', notice, room='lobby')
    return jsonify({'ok': True, 'notice_id': notice_id})


@app.route('/api/notices/<notice_id>', methods=['PUT'])
@admin_required
def edit_notice(notice_id):
    data = request.get_json()
    title = sanitize((data.get('title') or '').strip())
    content = sanitize((data.get('content') or '').strip())
    if not title:
        return jsonify({'error': '제목을 입력하세요.'}), 400
    image_url = (data.get('image_url') or '').strip()
    db.update_notice(notice_id, title, content, image_url=image_url or None)
    game_logger.log_notice_updated(session['user_id'], notice_id)
    socketio.emit('notice_updated', {'notice_id': notice_id, 'title': title, 'content': content, 'image_url': image_url}, room='lobby')
    return jsonify({'ok': True})


@app.route('/api/notices/<notice_id>', methods=['DELETE'])
@admin_required
def remove_notice(notice_id):
    db.delete_notice(notice_id)
    game_logger.log_notice_deleted(session['user_id'], notice_id)
    socketio.emit('notice_deleted', {'notice_id': notice_id}, room='lobby')
    return jsonify({'ok': True})


MEDIA_BUCKET = os.environ.get('LOG_BUCKET', '')  # reuse log bucket for media
ALLOWED_IMG_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp'}


@app.route('/api/upload-image', methods=['POST'])
@admin_required
def upload_image():
    f = request.files.get('image')
    if not f or not f.filename:
        return jsonify({'error': '이미지를 선택하세요.'}), 400
    ext = f.filename.rsplit('.', 1)[-1].lower() if '.' in f.filename else ''
    if ext not in ALLOWED_IMG_EXT:
        return jsonify({'error': '허용되지 않는 파일 형식입니다.'}), 400
    if not MEDIA_BUCKET:
        return jsonify({'error': '미디어 버킷이 설정되지 않았습니다.'}), 500
    key = f'media/notices/{uuid.uuid4().hex}.{ext}'
    region = os.environ.get('AWS_REGION', 'us-east-1')
    try:
        s3 = boto3.client('s3', region_name=region)
        s3.put_object(Bucket=MEDIA_BUCKET, Key=key, Body=f.read(),
                      ContentType=f.content_type or 'image/png')
        url = f'/api/media/{key}'
        game_logger.log_image_uploaded(session['user_id'], key)
        return jsonify({'ok': True, 'url': url})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/media/<path:key>')
@login_required
def serve_media(key):
    if not MEDIA_BUCKET:
        return 'Not configured', 404
    region = os.environ.get('AWS_REGION', 'us-east-1')
    try:
        s3 = boto3.client('s3', region_name=region)
        obj = s3.get_object(Bucket=MEDIA_BUCKET, Key=key)
        return Response(obj['Body'].read(),
                        content_type=obj.get('ContentType', 'image/png'),
                        headers={'Cache-Control': 'public, max-age=86400'})
    except Exception:
        return 'Not found', 404


# ──────────────────── Admin Force-Close ────────────────────

@app.route('/api/rooms/<room_id>/force-close', methods=['POST'])
@admin_required
def force_close_room(room_id):
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


# ──────────────────── DM API ────────────────────

@app.route('/api/dms/send', methods=['POST'])
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
        socketio.emit('dm_received', {
            'sender_id': uid,
            'message': message,
            'timestamp': dm['timestamp'],
            'conversation_id': conv_id,
        }, room=lobby_sids[recipient])
    return jsonify({'ok': True, 'dm': dm})


@app.route('/api/dms/<friend_id>', methods=['GET'])
@login_required
def dm_conversation(friend_id):
    uid = session['user_id']
    messages, last_key = db.get_conversation(uid, friend_id)
    return jsonify({'messages': messages, 'last_key': last_key})


@app.route('/api/dms/<friend_id>/read', methods=['POST'])
@login_required
def dm_mark_read(friend_id):
    uid = session['user_id']
    db.mark_as_read(uid, friend_id, uid)
    conv_id = '#'.join(sorted([uid, friend_id]))
    game_logger.log_dm_read(uid, conv_id)
    # Notify sender that messages were read
    if friend_id in lobby_sids:
        socketio.emit('dm_read', {
            'reader_id': uid,
            'conversation_id': db.make_conversation_id(uid, friend_id),
        }, room=lobby_sids[friend_id])
    return jsonify({'ok': True})


@app.route('/api/dms/unread', methods=['GET'])
@login_required
def dm_unread():
    uid = session['user_id']
    counts = db.get_unread_counts(uid)
    return jsonify({'counts': counts})


# ──────────────────── SocketIO ────────────────────

@socketio.on('connect')
def on_connect():
    app.logger.info(f'[SocketIO] Client connected: sid={request.sid}')


@socketio.on('join_lobby')
def on_join_lobby(data):
    uid = data['user_id']
    join_room('lobby')
    lobby_sids[uid] = request.sid
    sid_info[request.sid] = {'user_id': uid, 'room_id': 'lobby', 'context': 'lobby'}
    db.update_user_status(uid, 'online')
    broadcast_rooms()
    user = db.get_user(uid)
    ip = user.get('public_ip', '') if user else ''
    broadcast_friend_status(uid, 'online', ip)


@socketio.on('join_solo')
def on_join_solo(data):
    uid = data['user_id']
    join_room('lobby')
    lobby_sids[uid] = request.sid
    sid_info[request.sid] = {'user_id': uid, 'room_id': 'lobby', 'context': 'solo'}


@socketio.on('user_status')
def on_user_status(data):
    uid = data.get('user_id')
    status = data.get('status')
    if uid and status in ('online', 'chilling', 'ingame', 'spectating', 'waiting', 'practicing'):
        user = db.get_user(uid)
        if not user or user.get('status') == 'offline':
            return
        old_status = user.get('status', 'offline')
        if old_status == status:
            return
        # Don't allow visibility-triggered changes (online/chilling) to override game statuses
        if old_status in ('waiting', 'ingame', 'spectating', 'practicing') and status in ('online', 'chilling'):
            return
        db.update_user_status(uid, status)
        game_logger.log_status_change(uid, old_status, status)
        ip = user.get('public_ip', '') if user else ''
        broadcast_friend_status(uid, status, ip)


@socketio.on('join_waiting')
def on_join_waiting(data):
    rid = data['room_id']
    uid = data['user_id']
    app.logger.info(f'[join_waiting] rid={rid} uid={uid} sid={request.sid}')
    join_room(rid)
    lobby_sids[uid] = request.sid  # Update SID so invites reach this socket
    sid_info[request.sid] = {'user_id': uid, 'room_id': rid, 'context': 'waiting'}
    db.update_user_status(uid, 'waiting')
    broadcast_friend_status(uid, 'waiting')
    waiting_conns.setdefault(rid, set()).add(uid)
    players = list(waiting_conns[rid])
    room = db.get_room(rid)
    max_p = room.get('max_players', 2) if room else 2
    host = room.get('host', '') if room else ''
    app.logger.info(f'[join_waiting] room={room.get("game") if room else "?"} players={players} waiting={len(waiting_conns[rid])} max_p={max_p}')
    emit('room_update', {'players': players, 'count': len(players), 'max_players': max_p, 'host': host}, room=rid)
    broadcast_rooms()
    min_to_start = 2 if room and room['game'] in ('poker', 'rummikub') else max_p
    if len(waiting_conns[rid]) >= min_to_start:
        if room and room['status'] == 'waiting':
            db.set_room_status(rid, 'playing')
            url = f"/{room['game']}?room_id={rid}"
            game_logger.log_game_start(rid, room['game'], list(waiting_conns[rid]))
            emit('game_started', {'url': url}, room=rid)
            broadcast_rooms()


@socketio.on('force_start')
def on_force_start(data):
    rid = data['room_id']
    uid = data['user_id']
    room = db.get_room(rid)
    if not room or room['status'] != 'waiting':
        return
    # Only host can force start
    if room.get('host') != uid:
        return
    players = room.get('players', [])
    min_start = 2
    if len(players) < min_start:
        return
    db.set_room_status(rid, 'playing')
    url = f"/{room['game']}?room_id={rid}"
    game_logger.log_game_start(rid, room['game'], players, forced=True)
    emit('game_started', {'url': url}, room=rid)
    broadcast_rooms()


@socketio.on('join_game')
def on_join_game(data):
    rid = data['room_id']
    uid = data['user_id']
    join_room(rid)
    sid_info[request.sid] = {'user_id': uid, 'room_id': rid, 'context': 'game'}
    game_conns.setdefault(rid, set()).add(uid)
    room = db.get_room(rid)
    game_logger.log('game_activity', 'player_join_game', room_id=rid, user_id=uid,
                     game=room.get('game', '') if room else '')
    # Use actual player count (not max_players) for force-started games
    actual_players = len(room.get('players', [])) if room else 2
    if len(game_conns[rid]) >= actual_players:
        ready_data = {}
        # For tetris: send synchronized seed so all players get same piece queue
        if room and room.get('game') == 'tetris':
            ready_data['seed'] = random.randint(0, 0xFFFFFFFF)
        emit('game_ready', ready_data, room=rid)
    broadcast_participants(rid)


@socketio.on('join_spectate')
def on_join_spectate(data):
    rid = data['room_id']
    uid = data['user_id']
    join_room(rid)
    sid_info[request.sid] = {'user_id': uid, 'room_id': rid, 'context': 'spectate'}
    spectator_conns.setdefault(rid, set()).add(uid)
    lobby_sids[uid] = request.sid  # Allow receiving invites while spectating
    game_logger.log_spectate_join(rid, uid)
    # Send cached game state
    if rid in game_states:
        sync_data = dict(game_states[rid])
        if 'eliminated' in sync_data and isinstance(sync_data['eliminated'], set):
            sync_data['eliminated'] = list(sync_data['eliminated'])
        emit('game_state_sync', sync_data)
    broadcast_participants(rid)


@socketio.on('game_move')
def on_game_move(data):
    rid = data['room_id']
    # Cache moves for spectators (omok/chess)
    game_states.setdefault(rid, {'moves': []})
    if 'moves' not in game_states[rid]:
        game_states[rid]['moves'] = []
    game_states[rid]['moves'].append(data)
    room = db.get_room(rid)
    game_logger.log_game_move(rid, data.get('user_id', ''),
                              room.get('game', '') if room else '', move_data=data.get('type'))
    emit('opponent_move', data, room=rid, include_self=False)


@socketio.on('tetris_state')
def on_tetris_state(data):
    rid = data['room_id']
    uid = data.get('user_id', '')
    # Cache for spectators
    gs = game_states.setdefault(rid, {'players': {}, 'eliminated': set()})
    if 'players' not in gs:
        gs['players'] = {}
    gs['players'][uid] = {
        'board': data['board'],
        'score': data['score'],
        'level': data.get('level', 1),
        'lines': data.get('lines', 0),
        'piece': data.get('piece'),
    }
    game_logger.log_tetris_state(rid, uid, data['score'],
                                 data.get('level', 1), data.get('lines', 0))
    emit('opponent_state', data, room=rid, include_self=False)


@socketio.on('tetris_attack')
def on_tetris_attack(data):
    rid = data['room_id']
    attacker = data['user_id']
    attack_lines = data.get('lines', 0)
    if attack_lines < 1:
        return
    # Send garbage lines = cleared - 1 (clear 1 → 0, clear 2 → 1, clear 3 → 2, clear 4 → 3)
    garbage = attack_lines - 1
    if garbage < 1:
        return
    # Pick a random active (non-eliminated) opponent
    active = game_conns.get(rid, set()) - {attacker}
    gs = game_states.get(rid, {})
    elim = gs.get('eliminated', set())
    targets = [u for u in active if u not in elim]
    if not targets:
        return
    target = random.choice(targets)
    hole = random.randint(0, 9)
    # Find target's SID and send garbage
    for sid, info in sid_info.items():
        if info.get('user_id') == target and info.get('room_id') == rid and info.get('context') == 'game':
            socketio.emit('tetris_garbage', {'lines': garbage, 'hole': hole}, room=sid)
            game_logger.log_game_move(rid, attacker, 'tetris',
                                      move_data={'type': 'attack', 'target': target, 'lines': garbage})
            break


def destroy_game_room(rid):
    """Delete room from DB, kick spectators, clean up in-memory state."""
    socketio.emit('room_destroyed', {}, room=rid)
    game_logger.log_room_delete(rid, reason='all_left')
    db.delete_room(rid)
    game_conns.pop(rid, None)
    game_chats.pop(rid, None)
    game_states.pop(rid, None)
    spectator_conns.pop(rid, None)
    broadcast_rooms()


def broadcast_participants(rid):
    """Broadcast current player and spectator list to the room."""
    players = list(game_conns.get(rid, set()))
    spectators = list(spectator_conns.get(rid, set()))
    socketio.emit('participants_update', {
        'players': players,
        'spectators': spectators,
    }, room=rid)


@socketio.on('game_over_event')
def on_game_over(data):
    rid = data.get('room_id')
    loser = data.get('loser') or data.get('user_id')
    room = db.get_room(rid) if rid else None

    # Poker manages its own game lifecycle
    if room and room.get('game') == 'poker':
        return

    if room and room['game'] == 'tetris' and room.get('max_players', 2) > 2:
        # Multi-player tetris: elimination mode
        gs = game_states.setdefault(rid, {'players': {}, 'eliminated': set()})
        if 'eliminated' not in gs:
            gs['eliminated'] = set()
        gs['eliminated'].add(loser)
        game_logger.log_player_eliminated(rid, room['game'], loser)
        emit('player_eliminated', {'user_id': loser}, room=rid)

        all_players = set(room.get('players', []))
        alive = all_players - gs['eliminated']
        if len(alive) <= 1 and alive:
            winner = alive.pop()
            game_logger.log_game_over(rid, room['game'], winner=winner,
                                      loser=list(gs['eliminated']))
            emit('game_winner', {'winner': winner}, room=rid)
            destroy_game_room(rid)
    else:
        # 2-player game: notify opponent of victory.
        # Mark game as finished so disconnect handler won't emit false game_winner
        gs = game_states.setdefault(rid, {})
        gs['finished'] = True
        players = set(room.get('players', [])) if room else set()
        winner_2p = (players - {loser}).pop() if len(players) == 2 else None
        game_logger.log_game_over(rid, room['game'] if room else 'unknown',
                                  winner=winner_2p, loser=loser)
        emit('opponent_game_over', data, room=rid, include_self=False)


@socketio.on('poker_join_request')
def on_poker_join_request(data):
    rid = data.get('room_id')
    uid = data.get('user_id')
    if rid:
        game_logger.log_poker_mid_join(rid, uid)
        emit('poker_player_joined', {'user_id': uid}, room=rid)


@socketio.on('coaching_suggest')
def on_coaching_suggest(data):
    rid = data.get('room_id')
    if rid:
        room = db.get_room(rid)
        if room and room.get('allow_coaching'):
            game_logger.log_coaching(rid, data.get('user_id', ''), room.get('game', ''))
            emit('coaching_update', data, room=rid)


@socketio.on('coaching_clear')
def on_coaching_clear(data):
    rid = data.get('room_id')
    uid = data.get('user_id')
    if rid:
        game_logger.log_coaching_clear(rid, uid)
        emit('coaching_cleared', {'user_id': uid}, room=rid)


# ──────────────────── Game Chat ────────────────────

@socketio.on('game_chat')
def on_game_chat(data):
    rid = data.get('room_id')
    uid = data.get('user_id')
    message = sanitize((data.get('message') or '').strip())
    if not rid or not uid or not message:
        return
    # Limit message length
    message = message[:200]
    # Determine role (player or spectator)
    is_player = rid in game_conns and uid in game_conns[rid]
    role = 'Player' if is_player else 'Spectator'
    chat_msg = {
        'user_id': uid,
        'role': role,
        'message': message,
        'timestamp': int(time.time() * 1000),
    }
    game_logger.log_chat(rid, uid, role, message)
    game_chats.setdefault(rid, []).append(chat_msg)
    # Keep only last 100 messages
    if len(game_chats[rid]) > 100:
        game_chats[rid] = game_chats[rid][-100:]
    emit('chat_message', chat_msg, room=rid, include_self=False)


# ──────────────────── Invite System ────────────────────

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
        broadcast_rooms()
    else:
        reason = '거절됨' if not accepted else '방이 가득 찼습니다.'
        if host_sid:
            emit('invite_result', {'friend_id': uid, 'accepted': False, 'reason': reason}, to=host_sid)
        if accepted:
            emit('invite_accepted', {'error': '방이 가득 찼습니다.'})


# ──────────────────── Disconnect ────────────────────

@socketio.on('disconnect')
def on_disconnect():
    info = sid_info.pop(request.sid, None)
    if not info:
        return
    rid = info['room_id']
    uid = info['user_id']

    if info['context'] in ('lobby', 'solo'):
        if uid in lobby_sids and lobby_sids[uid] == request.sid:
            del lobby_sids[uid]
        user = db.get_user(uid)
        current_status = user.get('status', 'offline') if user else 'offline'
        if info['context'] == 'solo':
            # Leaving solo game page — restore to online
            if current_status == 'practicing':
                db.update_user_status(uid, 'online')
                broadcast_friend_status(uid, 'online')
        else:
            # Lobby disconnect — only set offline if not navigating to waiting/game/spectate
            if current_status not in ('waiting', 'ingame', 'spectating', 'practicing'):
                db.update_user_status(uid, 'offline')
                broadcast_friend_status(uid, 'offline')
        leave_room('lobby')
    elif info['context'] == 'waiting':
        leave_room(rid)
        if uid in lobby_sids and lobby_sids[uid] == request.sid:
            del lobby_sids[uid]
        if rid in waiting_conns:
            waiting_conns[rid].discard(uid)
        # Only remove from DB if room is still waiting
        # (if room is 'playing', player is navigating to the game page, not leaving)
        room = db.get_room(rid)
        if room and room.get('status') == 'waiting':
            game_logger.log_room_leave(rid, uid, reason='disconnect_waiting')
            updated_room = db.remove_player_from_room(rid, uid)
            if updated_room:
                players = updated_room.get('players', [])
                if len(players) == 0:
                    # Room empty — delete it
                    game_logger.log_room_delete(rid, reason='empty')
                    db.delete_room(rid)
                    waiting_conns.pop(rid, None)
                    broadcast_rooms()
                else:
                    # If host left, transfer to last joined player
                    if updated_room.get('host') == uid:
                        new_host = players[-1]
                        db.update_room_host(rid, new_host)
                        game_logger.log_room_host_transfer(rid, uid, new_host)
                        updated_room['host'] = new_host
                    host = updated_room.get('host', players[0])
                    emit('room_update', {
                        'players': players,
                        'count': len(players),
                        'max_players': updated_room.get('max_players', 2),
                        'host': host,
                    }, room=rid)
                    broadcast_rooms()
            # Restore user status after leaving waiting room
            # Set 'online' optimistically — lobby join or next page load will correct
            db.update_user_status(uid, 'online')
            broadcast_friend_status(uid, 'online')
    elif info['context'] == 'game':
        leave_room(rid)
        if rid in game_conns:
            game_conns[rid].discard(uid)
            game_logger.log_room_leave(rid, uid, reason='disconnect_game')
            emit('opponent_disconnected', {'user_id': uid}, room=rid)

            room = db.get_room(rid)

            # Poker: emit player_left so host can handle fold + removal
            if room and room.get('game') == 'poker':
                db.remove_player_from_room(rid, uid)
                emit('poker_player_left', {'user_id': uid}, room=rid)

            # Tetris multi-player: treat disconnect as elimination
            elif room and room['game'] == 'tetris' and room.get('max_players', 2) > 2:
                gs = game_states.setdefault(rid, {'players': {}, 'eliminated': set()})
                if 'eliminated' not in gs:
                    gs['eliminated'] = set()
                gs['eliminated'].add(uid)
                emit('player_eliminated', {'user_id': uid}, room=rid)
                all_players = set(room.get('players', []))
                alive = all_players - gs['eliminated']
                if len(alive) <= 1 and alive:
                    winner = alive.pop()
                    emit('game_winner', {'winner': winner}, room=rid)
                    destroy_game_room(rid)
                    return

            # Any game: if only 1 player remains and game hasn't ended yet, they win
            gs = game_states.get(rid, {})
            if len(game_conns.get(rid, set())) == 1 and not gs.get('finished'):
                winner = next(iter(game_conns[rid]))
                emit('game_winner', {'winner': winner}, room=rid)
                destroy_game_room(rid)
                return

            # Destroy room when all players leave
            if not game_conns.get(rid, set()):
                destroy_game_room(rid)
            else:
                broadcast_participants(rid)
    elif info['context'] == 'spectate':
        leave_room(rid)
        if rid in spectator_conns:
            spectator_conns[rid].discard(uid)
        game_logger.log_spectate_leave(rid, uid)
        if uid in lobby_sids and lobby_sids[uid] == request.sid:
            del lobby_sids[uid]
        broadcast_participants(rid)


# ──────────────────── Main ────────────────────

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
