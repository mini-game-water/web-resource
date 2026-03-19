import os
import uuid
from functools import wraps

from flask import Flask, render_template, request, redirect, url_for, session, jsonify
from flask_socketio import SocketIO, emit, join_room, leave_room

import db

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'game-hub-dev-secret-key')
socketio = SocketIO(app, async_mode='gevent')

# In-memory state (ephemeral SocketIO connection tracking — not persisted)
sid_info = {}
waiting_conns = {}
game_conns = {}
lobby_sids = {}  # user_id -> sid (index page + spectator connections)
spectator_conns = {}  # room_id -> set of user_ids
game_states = {}  # room_id -> cached game state for spectators


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper


def client_ip():
    xff = request.headers.get('X-Forwarded-For', '')
    return xff.split(',')[0].strip() if xff else request.remote_addr


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
            broadcast_friend_status(uid, 'online', ip)
            return redirect(url_for('index'))
        error = '아이디 또는 비밀번호가 올바르지 않습니다.'
    return render_template('login.html', error=error)


@app.route('/register', methods=['POST'])
def register():
    uid = request.form.get('user_id', '').strip()
    pw = request.form.get('password', '')
    if not uid or not pw:
        return render_template('login.html', error='아이디 또는 비밀번호를 확인해 주세요.', show_register=True)
    if not db.create_user(uid, pw):
        return render_template('login.html', error='이미 존재하는 아이디입니다.', show_register=True)
    return render_template('login.html', success='회원가입 성공! 로그인해 주세요.')


@app.route('/logout')
@login_required
def logout():
    uid = session.pop('user_id', None)
    if uid:
        db.update_user_logout(uid)
        broadcast_friend_status(uid, 'offline')
    return redirect(url_for('login'))


# ──────────────────── Pages ────────────────────

@app.route('/')
@login_required
def index():
    uid = session['user_id']
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
    return render_template('index.html', user_id=uid, user=user, friends=friends, rooms=room_list)


@app.route('/room/<room_id>')
@login_required
def room_page(room_id):
    room = db.get_room(room_id)
    if not room or session['user_id'] not in room.get('players', []):
        return redirect(url_for('index'))
    uid = session['user_id']
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
    my_player = None
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
    else:
        max_players = 2
    db.create_room(
        room_id=rid,
        name=data.get('name', 'Untitled'),
        game=game,
        password=data.get('password', ''),
        host=session['user_id'],
        max_players=max_players,
        allow_spectate=bool(data.get('allow_spectate')),
        allow_coaching=bool(data.get('allow_coaching')),
    )
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
    broadcast_rooms()
    return jsonify({'room_id': room_id})


@app.route('/api/friends/add', methods=['POST'])
@login_required
def add_friend():
    data = request.get_json()
    fid = data.get('friend_id', '').strip()
    uid = session['user_id']
    if fid == uid:
        return jsonify({'error': '자기 자신은 추가할 수 없습니다.'}), 400
    friend = db.get_user(fid)
    if not friend:
        return jsonify({'error': '사용자를 찾을 수 없습니다.'}), 404
    db.add_friend(uid, fid)
    return jsonify({'ok': True})


# ──────────────────── SocketIO ────────────────────

@socketio.on('join_lobby')
def on_join_lobby(data):
    uid = data['user_id']
    join_room('lobby')
    lobby_sids[uid] = request.sid
    sid_info[request.sid] = {'user_id': uid, 'room_id': 'lobby', 'context': 'lobby'}


@socketio.on('user_status')
def on_user_status(data):
    uid = data.get('user_id')
    status = data.get('status')
    if uid and status in ('online', 'chilling', 'ingame', 'spectating'):
        user = db.get_user(uid)
        if not user or user.get('status') == 'offline':
            return
        db.update_user_status(uid, status)
        ip = user.get('public_ip', '') if user else ''
        broadcast_friend_status(uid, status, ip)


@socketio.on('join_waiting')
def on_join_waiting(data):
    rid = data['room_id']
    uid = data['user_id']
    join_room(rid)
    sid_info[request.sid] = {'user_id': uid, 'room_id': rid, 'context': 'waiting'}
    waiting_conns.setdefault(rid, set()).add(uid)
    players = list(waiting_conns[rid])
    room = db.get_room(rid)
    max_p = room.get('max_players', 2) if room else 2
    host = room.get('host', '') if room else ''
    emit('room_update', {'players': players, 'count': len(players), 'max_players': max_p, 'host': host}, room=rid)
    if len(waiting_conns[rid]) >= max_p:
        if room and room['status'] == 'waiting':
            db.set_room_status(rid, 'playing')
            url = f"/{room['game']}?room_id={rid}"
            emit('game_started', {'url': url}, room=rid)
            broadcast_rooms()


@socketio.on('force_start')
def on_force_start(data):
    rid = data['room_id']
    uid = data['user_id']
    room = db.get_room(rid)
    if not room or room['status'] != 'waiting':
        return
    # Only host can force start, and need at least 2 players
    if room.get('host') != uid:
        return
    players = room.get('players', [])
    if len(players) < 2:
        return
    db.set_room_status(rid, 'playing')
    url = f"/{room['game']}?room_id={rid}"
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
    # Use actual player count (not max_players) for force-started games
    actual_players = len(room.get('players', [])) if room else 2
    if len(game_conns[rid]) >= actual_players:
        emit('game_ready', {}, room=rid)


@socketio.on('join_spectate')
def on_join_spectate(data):
    rid = data['room_id']
    uid = data['user_id']
    join_room(rid)
    sid_info[request.sid] = {'user_id': uid, 'room_id': rid, 'context': 'spectate'}
    spectator_conns.setdefault(rid, set()).add(uid)
    lobby_sids[uid] = request.sid  # Allow receiving invites while spectating
    # Send cached game state
    if rid in game_states:
        sync_data = dict(game_states[rid])
        if 'eliminated' in sync_data and isinstance(sync_data['eliminated'], set):
            sync_data['eliminated'] = list(sync_data['eliminated'])
        emit('game_state_sync', sync_data)


@socketio.on('game_move')
def on_game_move(data):
    rid = data['room_id']
    # Cache moves for spectators (omok/chess)
    game_states.setdefault(rid, {'moves': []})
    if 'moves' not in game_states[rid]:
        game_states[rid]['moves'] = []
    game_states[rid]['moves'].append(data)
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
    emit('opponent_state', data, room=rid, include_self=False)


@socketio.on('game_over_event')
def on_game_over(data):
    rid = data.get('room_id')
    loser = data.get('loser') or data.get('user_id')
    room = db.get_room(rid) if rid else None

    if room and room['game'] == 'tetris' and room.get('max_players', 2) > 2:
        # Multi-player tetris: elimination mode
        gs = game_states.setdefault(rid, {'players': {}, 'eliminated': set()})
        if 'eliminated' not in gs:
            gs['eliminated'] = set()
        gs['eliminated'].add(loser)
        emit('player_eliminated', {'user_id': loser}, room=rid)

        all_players = set(room.get('players', []))
        alive = all_players - gs['eliminated']
        if len(alive) <= 1 and alive:
            winner = alive.pop()
            emit('game_winner', {'winner': winner}, room=rid)
    else:
        emit('opponent_game_over', data, room=rid, include_self=False)


@socketio.on('coaching_suggest')
def on_coaching_suggest(data):
    rid = data.get('room_id')
    if rid:
        room = db.get_room(rid)
        if room and room.get('allow_coaching'):
            emit('coaching_update', data, room=rid, include_self=False)


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

    if accepted and len(room.get('players', [])) < room.get('max_players', 2):
        db.join_room(rid, uid)
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

    if info['context'] == 'lobby':
        if uid in lobby_sids and lobby_sids[uid] == request.sid:
            del lobby_sids[uid]
        leave_room('lobby')
    elif info['context'] == 'waiting':
        leave_room(rid)
        if rid in waiting_conns:
            waiting_conns[rid].discard(uid)
        # Only remove from DB if room is still waiting
        # (if room is 'playing', player is navigating to the game page, not leaving)
        room = db.get_room(rid)
        if room and room.get('status') == 'waiting':
            updated_room = db.remove_player_from_room(rid, uid)
            if updated_room:
                players = updated_room.get('players', [])
                if len(players) == 0:
                    # Room empty — delete it
                    db.delete_room(rid)
                    waiting_conns.pop(rid, None)
                    broadcast_rooms()
                else:
                    # If host left, transfer to last joined player
                    if updated_room.get('host') == uid:
                        new_host = players[-1]
                        db.update_room_host(rid, new_host)
                        updated_room['host'] = new_host
                    host = updated_room.get('host', players[0])
                    emit('room_update', {
                        'players': players,
                        'count': len(players),
                        'max_players': updated_room.get('max_players', 2),
                        'host': host,
                    }, room=rid)
                    broadcast_rooms()
    elif info['context'] == 'game':
        leave_room(rid)
        if rid in game_conns:
            game_conns[rid].discard(uid)
            emit('opponent_disconnected', {'user_id': uid}, room=rid)
    elif info['context'] == 'spectate':
        leave_room(rid)
        if rid in spectator_conns:
            spectator_conns[rid].discard(uid)
        if uid in lobby_sids and lobby_sids[uid] == request.sid:
            del lobby_sids[uid]


# ──────────────────── Main ────────────────────

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
