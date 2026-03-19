import os
import time
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

ROOM_TTL_SECONDS = 3600  # 1 hour


# ──────────────────── User Operations ────────────────────

def get_user(user_id):
    resp = _users_table.get_item(Key={'user_id': user_id})
    item = resp.get('Item')
    return _convert_decimals(item) if item else None


def create_user(user_id, pw):
    try:
        _users_table.put_item(
            Item={
                'user_id': user_id,
                'pw': pw,
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


def add_friend(user_id, friend_id):
    try:
        _users_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET friends = list_append(if_not_exists(friends, :empty), :f)',
            ConditionExpression='NOT contains(friends, :fid)',
            ExpressionAttributeValues={
                ':f': [friend_id],
                ':empty': [],
                ':fid': friend_id,
            },
        )
        return True
    except ClientError as e:
        if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
            return False  # already friends
        raise


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


# ──────────────────── Room Operations ────────────────────

def get_room(room_id):
    if not room_id:
        return None
    resp = _rooms_table.get_item(Key={'room_id': room_id})
    item = resp.get('Item')
    return _convert_decimals(item) if item else None


def create_room(room_id, name, game, password, host):
    now = int(time.time())
    _rooms_table.put_item(
        Item={
            'room_id': room_id,
            'name': name,
            'game': game,
            'password': password,
            'host': host,
            'players': [host],
            'max_players': 2,
            'status': 'waiting',
            'created_at': now,
            'ttl': now + ROOM_TTL_SECONDS,
        }
    )


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


def set_room_status(room_id, status):
    _rooms_table.update_item(
        Key={'room_id': room_id},
        UpdateExpression='SET #s = :status',
        ExpressionAttributeNames={'#s': 'status'},
        ExpressionAttributeValues={':status': status},
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
