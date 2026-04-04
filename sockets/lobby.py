"""SocketIO handlers for lobby, waiting room, connect/disconnect."""

import random

from flask import request
from flask_socketio import emit, join_room, leave_room

import db
import game_logger
from state import sid_info, waiting_conns, game_conns, game_states, lobby_sids, spectator_conns
from sockets.helpers import broadcast_rooms, broadcast_friend_status, broadcast_participants, destroy_game_room


def register_lobby_events(socketio, app):
    """Register all lobby-related SocketIO event handlers."""

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
            if not user:
                return
            old_status = user.get('status', 'offline')
            if old_status == status:
                return
            # Don't allow visibility-triggered changes to override game statuses
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
        if room.get('host') != uid:
            return
        players = room.get('players', [])
        if len(players) < 2:
            return
        db.set_room_status(rid, 'playing')
        url = f"/{room['game']}?room_id={rid}"
        game_logger.log_game_start(rid, room['game'], players, forced=True)
        emit('game_started', {'url': url}, room=rid)
        broadcast_rooms()

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
                if current_status == 'practicing':
                    db.update_user_status(uid, 'online')
                    broadcast_friend_status(uid, 'online')
            else:
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
            room = db.get_room(rid)
            if room and room.get('status') == 'waiting':
                game_logger.log_room_leave(rid, uid, reason='disconnect_waiting')
                updated_room = db.remove_player_from_room(rid, uid)
                if updated_room:
                    players = updated_room.get('players', [])
                    if len(players) == 0:
                        game_logger.log_room_delete(rid, reason='empty')
                        db.delete_room(rid)
                        waiting_conns.pop(rid, None)
                        broadcast_rooms()
                    else:
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
