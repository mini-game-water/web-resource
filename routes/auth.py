"""Authentication routes: login, register, logout."""

from flask import Blueprint, render_template, request, redirect, url_for, session

import db
import game_logger
from state import sanitize, client_ip
from routes.decorators import login_required

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/login', methods=['GET', 'POST'])
def login():
    if 'user_id' in session:
        return redirect(url_for('pages.index'))
    error = None
    if request.method == 'POST':
        uid = request.form.get('user_id', '').strip()
        pw = request.form.get('password', '')
        user = db.get_user(uid)
        if user and user['pw'] == pw:
            session['user_id'] = uid
            ip = client_ip(request)
            db.update_user_login(uid, ip)
            game_logger.log_login(uid, ip)
            return redirect(url_for('pages.index'))
        error = '아이디 또는 비밀번호가 올바르지 않습니다.'
    return render_template('login.html', error=error)


@auth_bp.route('/register', methods=['POST'])
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


@auth_bp.route('/logout')
@login_required
def logout():
    uid = session.pop('user_id', None)
    if uid:
        db.update_user_logout(uid)
        game_logger.log_logout(uid)
    return redirect(url_for('auth.login'))
