import os
import time
import uuid
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError


def _convert_decimals(obj):
    """Convert DynamoDB Decimal types to int/float for Jinja2 templates."""
    if isinstance(obj, Decimal):
        return int(obj) if obj == int(obj) else float(obj)
    if isinstance(obj, dict):
        return {k: _convert_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_convert_decimals(i) for i in obj]
    return obj

_region = os.environ.get('AWS_REGION', 'us-east-1')
_dynamodb = boto3.resource('dynamodb', region_name=_region)
_users_table = _dynamodb.Table(os.environ.get('USERS_TABLE', 'gamehub-users'))
_rooms_table = _dynamodb.Table(os.environ.get('ROOMS_TABLE', 'gamehub-rooms'))
_notices_table = _dynamodb.Table(os.environ.get('NOTICES_TABLE', 'gamehub-notices'))
_dms_table = _dynamodb.Table(os.environ.get('DMS_TABLE', 'gamehub-dms'))

ROOM_TTL_SECONDS = 3600  # 1 hour


# ──────────────────── User Operations ────────────────────

def get_user(user_id):
    resp = _users_table.get_item(Key={'user_id': user_id})
    item = resp.get('Item')
    return _convert_decimals(item) if item else None


def create_user(user_id, pw, name='', email=''):
    try:
        _users_table.put_item(
            Item={
                'user_id': user_id,
                'pw': pw,
                'name': name,
                'email': email,
                'role': 'user',
                'score': 0,
                'status': 'offline',
                'public_ip': '',
                'friends': [],
            },
            ConditionExpression='attribute_not_exists(user_id)',
        )
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False
        raise


def update_user_login(user_id, public_ip):
    _users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET #s = :status, public_ip = :ip',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': 'online', ':ip': public_ip},
    )


def update_user_logout(user_id):
    _users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET #s = :status, public_ip = :empty',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': 'offline', ':empty': ''},
    )


def update_user_status(user_id, status):
    _users_table.update_item(
        Key={'user_id': user_id},
        UpdateExpression='SET #s = :status',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': status},
    )


def update_user_profile(user_id, pw=None, name=None, email=None):
    parts = []
    names = {}
    values = {}
    if pw is not None:
        parts.append('pw = :pw')
        values[':pw'] = pw
    if name is not None:
        parts.append('#n = :name')
        names['#n'] = 'name'
        values[':name'] = name
    if email is not None:
        parts.append('email = :email')
        values[':email'] = email
    if not parts:
        return
    expr = 'SET ' + ', '.join(parts)
    kwargs = {
        'Key': {'user_id': user_id},
        'UpdateExpression': expr,
        'ExpressionAttributeValues': values,
    }
    if names:
        kwargs['ExpressionAttributeNames'] = names
    _users_table.update_item(**kwargs)


def delete_user(user_id):
    _users_table.delete_item(Key={'user_id': user_id})


def add_friend(user_id, friend_id):
    """Add friend_id to user_id's friends list (both directions for mutual friendship)."""
    for a, b in [(user_id, friend_id), (friend_id, user_id)]:
        try:
            _users_table.update_item(
                Key={'user_id': a},
                UpdateExpression='SET friends = list_append(if_not_exists(friends, :empty), :f)',
                ConditionExpression='NOT contains(friends, :fid)',
                ExpressionAttributeValues={
                    ':f': [b],
                    ':empty': [],
                    ':fid': b,
                },
            )
        except ClientError as e:
            if e.response['Error']['Code'] != 'ConditionalCheckFailedException':
                raise
    return True


def send_friend_request(from_id, to_id):
    """Add from_id to to_id's friend_requests list."""
    try:
        _users_table.update_item(
            Key={'user_id': to_id},
            UpdateExpression='SET friend_requests = list_append(if_not_exists(friend_requests, :empty), :f)',
            ConditionExpression='attribute_not_exists(friend_requests) OR NOT contains(friend_requests, :fid)',
            ExpressionAttributeValues={
                ':f': [from_id],
                ':empty': [],
                ':fid': from_id,
            },
        )
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False  # already requested
        raise


def remove_friend(user_id, friend_id):
    """Remove friend_id from user_id's friends list (both directions)."""
    for a, b in [(user_id, friend_id), (friend_id, user_id)]:
        user = get_user(a)
        if not user:
            continue
        friends = user.get('friends', [])
        if b in friends:
            friends.remove(b)
            _users_table.update_item(
                Key={'user_id': a},
                UpdateExpression='SET friends = :f',
                ExpressionAttributeValues={':f': friends},
            )


def remove_friend_request(user_id, requester_id):
    """Remove requester_id from user_id's friend_requests list."""
    user = get_user(user_id)
    if not user:
        return
    requests = user.get('friend_requests', [])
    if requester_id in requests:
        requests.remove(requester_id)
        _users_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET friend_requests = :r',
            ExpressionAttributeValues={':r': requests},
        )


def get_friend_requests(user_id):
    """Get list of pending friend request user IDs."""
    user = get_user(user_id)
    if not user:
        return []
    return user.get('friend_requests', [])


def batch_get_users(user_ids):
    if not user_ids:
        return {}
    keys = [{'user_id': uid} for uid in user_ids]
    result = {}
    # BatchGetItem supports max 100 keys per request
    for i in range(0, len(keys), 100):
        batch = keys[i:i + 100]
        resp = _dynamodb.batch_get_item(
            RequestItems={
                _users_table.name: {
                    'Keys': batch,
                    'ProjectionExpression': 'user_id, score, #s, public_ip',
                    'ExpressionAttributeNames': {'#s': 'status'},
                }
            }
        )
        for item in resp.get('Responses', {}).get(_users_table.name, []):
            result[item['user_id']] = _convert_decimals(item)
        # Handle unprocessed keys
        unprocessed = resp.get('UnprocessedKeys', {}).get(_users_table.name)
        while unprocessed:
            resp = _dynamodb.batch_get_item(
                RequestItems={_users_table.name: unprocessed}
            )
            for item in resp.get('Responses', {}).get(_users_table.name, []):
                result[item['user_id']] = _convert_decimals(item)
            unprocessed = resp.get('UnprocessedKeys', {}).get(_users_table.name)
    return result


# ──────────────────── Notice Operations ────────────────────

def create_notice(author, title, content, image_url=''):
    notice_id = uuid.uuid4().hex[:8]
    now = int(time.time())
    item = {
        'notice_id': notice_id,
        'author': author,
        'title': title,
        'content': content,
        'created_at': now,
    }
    if image_url:
        item['image_url'] = image_url
    _notices_table.put_item(Item=item)
    return notice_id


def list_notices():
    resp = _notices_table.scan()
    items = resp.get('Items', [])
    while 'LastEvaluatedKey' in resp:
        resp = _notices_table.scan(ExclusiveStartKey=resp['LastEvaluatedKey'])
        items.extend(resp.get('Items', []))
    items.sort(key=lambda x: x.get('created_at', 0), reverse=True)
    return [_convert_decimals(item) for item in items]


def update_notice(notice_id, title, content, image_url=None):
    expr = 'SET title = :t, content = :c'
    vals = {':t': title, ':c': content}
    if image_url is not None:
        expr += ', image_url = :img'
        vals[':img'] = image_url
    _notices_table.update_item(
        Key={'notice_id': notice_id},
        UpdateExpression=expr,
        ExpressionAttributeValues=vals,
    )


def delete_notice(notice_id):
    _notices_table.delete_item(Key={'notice_id': notice_id})


# ──────────────────── Room Operations ────────────────────

def get_room(room_id):
    if not room_id:
        return None
    resp = _rooms_table.get_item(Key={'room_id': room_id})
    item = resp.get('Item')
    return _convert_decimals(item) if item else None


def create_room(room_id, name, game, password, host, max_players=2,
                allow_spectate=False, allow_coaching=False):
    now = int(time.time())
    _rooms_table.put_item(
        Item={
            'room_id': room_id,
            'name': name,
            'game': game,
            'password': password,
            'host': host,
            'players': [host],
            'max_players': max_players,
            'status': 'waiting',
            'allow_spectate': allow_spectate,
            'allow_coaching': allow_coaching,
            'created_at': now,
            'ttl': now + ROOM_TTL_SECONDS,
        }
    )


def list_spectatable_rooms():
    items = []
    resp = _rooms_table.query(
        IndexName='status-index',
        KeyConditionExpression=Key('status').eq('playing'),
    )
    items.extend(resp.get('Items', []))
    while 'LastEvaluatedKey' in resp:
        resp = _rooms_table.query(
            IndexName='status-index',
            KeyConditionExpression=Key('status').eq('playing'),
            ExclusiveStartKey=resp['LastEvaluatedKey'],
        )
        items.extend(resp.get('Items', []))
    return [_convert_decimals(item) for item in items if item.get('allow_spectate')]


def join_room(room_id, user_id):
    try:
        resp = _rooms_table.update_item(
            Key={'room_id': room_id},
            UpdateExpression='SET players = list_append(players, :p)',
            ConditionExpression='size(players) < #mp AND NOT contains(players, :uid)',
            ExpressionAttributeNames={'#mp': 'max_players'},
            ExpressionAttributeValues={':p': [user_id], ':uid': user_id},
            ReturnValues='ALL_NEW',
        )
        return resp.get('Attributes')
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return None  # room full or already joined
        raise


def remove_player_from_room(room_id, user_id):
    """Remove a player from room's players list. Returns updated room or None if room not found."""
    room = get_room(room_id)
    if not room:
        return None
    players = room.get('players', [])
    if user_id not in players:
        return room
    idx = players.index(user_id)
    try:
        resp = _rooms_table.update_item(
            Key={'room_id': room_id},
            UpdateExpression=f'REMOVE players[{idx}]',
            ReturnValues='ALL_NEW',
        )
        return _convert_decimals(resp.get('Attributes'))
    except ClientError:
        return None


def delete_room(room_id):
    _rooms_table.delete_item(Key={'room_id': room_id})


def update_room_host(room_id, new_host):
    _rooms_table.update_item(
        Key={'room_id': room_id},
        UpdateExpression='SET host = :h',
        ExpressionAttributeValues={':h': new_host},
    )


def set_room_status(room_id, status):
    _rooms_table.update_item(
        Key={'room_id': room_id},
        UpdateExpression='SET #s = :status',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': status},
    )


# ──────────────────── DM Operations ────────────────────

def make_conversation_id(user1, user2):
    return '#'.join(sorted([user1, user2]))


def send_dm(sender_id, recipient_id, message):
    conv_id = make_conversation_id(sender_id, recipient_id)
    ts = int(time.time() * 1000)
    item = {
        'conversation_id': conv_id,
        'timestamp': ts,
        'dm_id': uuid.uuid4().hex,
        'sender_id': sender_id,
        'recipient_id': recipient_id,
        'message': message,
        'read': False,
    }
    _dms_table.put_item(Item=item)
    return _convert_decimals(item)


def get_conversation(user1, user2, limit=50, last_key=None):
    conv_id = make_conversation_id(user1, user2)
    kwargs = {
        'KeyConditionExpression': Key('conversation_id').eq(conv_id),
        'ScanIndexForward': False,
        'Limit': limit,
    }
    if last_key:
        kwargs['ExclusiveStartKey'] = last_key
    resp = _dms_table.query(**kwargs)
    items = [_convert_decimals(i) for i in resp.get('Items', [])]
    return items, resp.get('LastEvaluatedKey')


def get_unread_counts(user_id):
    resp = _dms_table.query(
        IndexName='recipient-index',
        KeyConditionExpression=Key('recipient_id').eq(user_id),
        FilterExpression='#r = :false',
        ExpressionAttributeNames={'#r': 'read'},
        ExpressionAttributeValues={':false': False},
    )
    counts = {}
    for item in resp.get('Items', []):
        conv_id = item['conversation_id']
        counts[conv_id] = counts.get(conv_id, 0) + 1
    return counts


def mark_as_read(user1, user2, recipient_id):
    conv_id = make_conversation_id(user1, user2)
    resp = _dms_table.query(
        KeyConditionExpression=Key('conversation_id').eq(conv_id),
        FilterExpression='recipient_id = :rid AND #r = :false',
        ExpressionAttributeNames={'#r': 'read'},
        ExpressionAttributeValues={':rid': recipient_id, ':false': False},
    )
    for item in resp.get('Items', []):
        _dms_table.update_item(
            Key={'conversation_id': conv_id, 'timestamp': item['timestamp']},
            UpdateExpression='SET #r = :true',
            ExpressionAttributeNames={'#r': 'read'},
            ExpressionAttributeValues={':true': True},
        )


def list_waiting_rooms():
    items = []
    resp = _rooms_table.query(
        IndexName='status-index',
        KeyConditionExpression=Key('status').eq('waiting'),
    )
    items.extend(resp.get('Items', []))
    while 'LastEvaluatedKey' in resp:
        resp = _rooms_table.query(
            IndexName='status-index',
            KeyConditionExpression=Key('status').eq('waiting'),
            ExclusiveStartKey=resp['LastEvaluatedKey'],
        )
        items.extend(resp.get('Items', []))
    return [_convert_decimals(item) for item in items]
