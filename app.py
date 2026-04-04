"""Game Hub — Flask + SocketIO entry point.

Registers all route blueprints and SocketIO event handlers.
Business logic lives in routes/, sockets/, db.py, and game_logger.py.
"""

import os

from flask import Flask, render_template, jsonify
from flask_wtf.csrf import CSRFProtect
from flask_socketio import SocketIO

import game_logger

# ──────────────────── App Setup ────────────────────

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'game-hub-dev-secret-key')
app.config['WTF_CSRF_CHECK_DEFAULT'] = False
csrf = CSRFProtect(app)
socketio = SocketIO(app, async_mode='gevent', cors_allowed_origins='*',
                    logger=True, engineio_logger=True)

game_logger.init()


# ──────────────────── CSRF for non-SocketIO ────────────────────

@app.before_request
def csrf_protect_non_socketio():
    from flask import request
    if request.path.startswith('/socket.io'):
        return
    csrf.protect()


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


# ──────────────────── Health Check ────────────────────

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'socketio': 'enabled',
                    'cors': app.config.get('WTF_CSRF_CHECK_DEFAULT', True)})


# ──────────────────── Register Blueprints ────────────────────

from routes.auth import auth_bp
from routes.pages import pages_bp
from routes.api_rooms import rooms_bp
from routes.api_friends import friends_bp
from routes.api_profile import profile_bp
from routes.api_notices import notices_bp
from routes.api_dms import dms_bp

app.register_blueprint(auth_bp)
app.register_blueprint(pages_bp)
app.register_blueprint(rooms_bp)
app.register_blueprint(friends_bp)
app.register_blueprint(profile_bp)
app.register_blueprint(notices_bp)
app.register_blueprint(dms_bp)


# ──────────────────── Register SocketIO Events ────────────────────

from sockets.lobby import register_lobby_events
from sockets.game import register_game_events
from sockets.invite import register_invite_events

register_lobby_events(socketio, app)
register_game_events(socketio, app)
register_invite_events(socketio, app)


# ──────────────────── Main ────────────────────

if __name__ == '__main__':
    socketio.run(app, debug=True, host='0.0.0.0', port=5000)
