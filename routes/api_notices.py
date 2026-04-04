"""Notice board API routes + image upload/serve."""

import os
import uuid
import time

import boto3
from flask import Blueprint, request, session, jsonify, Response

import db
import game_logger
from state import sanitize
from routes.decorators import login_required, admin_required
from sockets.helpers import get_socketio

notices_bp = Blueprint('notices', __name__)

MEDIA_BUCKET = os.environ.get('LOG_BUCKET', '')  # reuse log bucket for media
ALLOWED_IMG_EXT = {'png', 'jpg', 'jpeg', 'gif', 'webp'}


@notices_bp.route('/api/notices', methods=['GET'])
@login_required
def get_notices():
    notices = db.list_notices()
    return jsonify({'notices': notices})


@notices_bp.route('/api/notices', methods=['POST'])
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
    socketio = get_socketio()
    socketio.emit('notice_posted', notice, room='lobby')
    return jsonify({'ok': True, 'notice_id': notice_id})


@notices_bp.route('/api/notices/<notice_id>', methods=['PUT'])
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
    socketio = get_socketio()
    socketio.emit('notice_updated', {'notice_id': notice_id, 'title': title,
                                     'content': content, 'image_url': image_url}, room='lobby')
    return jsonify({'ok': True})


@notices_bp.route('/api/notices/<notice_id>', methods=['DELETE'])
@admin_required
def remove_notice(notice_id):
    db.delete_notice(notice_id)
    game_logger.log_notice_deleted(session['user_id'], notice_id)
    socketio = get_socketio()
    socketio.emit('notice_deleted', {'notice_id': notice_id}, room='lobby')
    return jsonify({'ok': True})


@notices_bp.route('/api/upload-image', methods=['POST'])
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


@notices_bp.route('/api/media/<path:key>')
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
