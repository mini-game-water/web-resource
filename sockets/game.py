"""SocketIO handlers for in-game events: moves, tetris, chat, spectate, coaching."""

import time
import random

from flask import request
from flask_socketio import emit, join_room

import db
import game_logger
from state import sid_info, game_conns, game_states, game_chats, spectator_conns, lobby_sids, sanitize
from sockets.helpers import broadcast_participants, destroy_game_room


def register_game_events(socketio, app):
    """Register all game-related SocketIO event handlers."""

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
        for sid, info in sid_info.items():
            if info.get('user_id') == target and info.get('room_id') == rid and info.get('context') == 'game':
                socketio.emit('tetris_garbage', {'lines': garbage, 'hole': hole}, room=sid)
                game_logger.log_game_move(rid, attacker, 'tetris',
                                          move_data={'type': 'attack', 'target': target, 'lines': garbage})
                break

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
            # 2-player game: notify opponent of victory
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

    @socketio.on('game_chat')
    def on_game_chat(data):
        rid = data.get('room_id')
        uid = data.get('user_id')
        message = sanitize((data.get('message') or '').strip())
        if not rid or not uid or not message:
            return
        message = message[:200]
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
        if len(game_chats[rid]) > 100:
            game_chats[rid] = game_chats[rid][-100:]
        emit('chat_message', chat_msg, room=rid, include_self=False)
