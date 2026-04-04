"""Page routes: index, room, and all 9 game routes."""

from flask import Blueprint, render_template, request, redirect, url_for, session

import db
import game_logger
from state import spectator_conns
from routes.decorators import login_required
from sockets.helpers import broadcast_friend_status

pages_bp = Blueprint('pages', __name__)


@pages_bp.route('/')
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


@pages_bp.route('/room/<room_id>')
@login_required
def room_page(room_id):
    game_logger.log_page_view(session['user_id'], 'room', room_id=room_id,
                              user_agent=request.headers.get('User-Agent', ''))
    room = db.get_room(room_id)
    if not room:
        return render_template('room_not_found.html'), 404
    if session['user_id'] not in room.get('players', []):
        return redirect(url_for('pages.index'))

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
        return redirect(url_for('pages.index'))
    return render_template(template, room_id=room_id, room=room,
                           my_player=my_player, user_id=session['user_id'],
                           is_spectator=is_spectator)


@pages_bp.route('/tetris')
@login_required
def tetris():
    return _game_route('tetris.html')


@pages_bp.route('/omok')
@login_required
def omok():
    return _game_route('omok.html')


@pages_bp.route('/chess')
@login_required
def chess():
    return _game_route('chess.html')


@pages_bp.route('/yacht')
@login_required
def yacht():
    return _game_route('yacht.html')


@pages_bp.route('/poker')
@login_required
def poker():
    return _game_route('poker.html')


@pages_bp.route('/rummikub')
@login_required
def rummikub():
    return _game_route('rummikub.html')


@pages_bp.route('/bang')
@login_required
def bang():
    return _game_route('bang.html')


@pages_bp.route('/splendor')
@login_required
def splendor():
    return _game_route('splendor.html')


@pages_bp.route('/halligalli')
@login_required
def halligalli():
    return _game_route('halligalli.html')
