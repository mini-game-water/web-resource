#!/usr/bin/env python3
"""
Migrate users from data/users.json to DynamoDB gamehub-users table.

Usage:
    python migrate_users.py                  # migrate all users
    python migrate_users.py --dry-run        # preview without writing
    python migrate_users.py --file alt.json  # use a different source file

DynamoDB gamehub-users schema (PK: user_id):
    user_id    (S)  - partition key
    pw         (S)  - password
    name       (S)  - display name
    email      (S)  - email address
    role       (S)  - 'user' or 'admin'
    score      (N)  - game score
    status     (S)  - 'offline' / 'online' / 'chilling'
    public_ip  (S)  - set on login, cleared on logout
    friends    (L)  - list of friend user_ids
"""

import argparse
import json
import os
import sys

import boto3
from botocore.exceptions import ClientError

REQUIRED_FIELDS = {'pw'}
DEFAULTS = {
    'name': '',
    'email': '',
    'role': 'user',
    'score': 0,
    'status': 'offline',
    'public_ip': '',
    'friends': [],
}


def load_users(path):
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def build_item(user_id, data):
    """Convert a users.json entry to a DynamoDB item matching db.py schema."""
    item = {'user_id': user_id}
    for field in REQUIRED_FIELDS:
        if field not in data:
            raise ValueError(f'User "{user_id}" missing required field: {field}')
        item[field] = data[field]
    for field, default in DEFAULTS.items():
        item[field] = data.get(field, default)
    # Always reset runtime fields
    item['status'] = 'offline'
    item['public_ip'] = ''
    return item


def migrate(source_path, region, table_name, dry_run=False):
    users = load_users(source_path)
    if not users:
        print('No users found in source file.')
        return

    print(f'Source:  {source_path} ({len(users)} users)')
    print(f'Target:  {table_name} ({region})')
    print(f'Mode:    {"DRY RUN" if dry_run else "LIVE"}')
    print()

    items = {}
    for uid, data in users.items():
        try:
            items[uid] = build_item(uid, data)
        except ValueError as e:
            print(f'  [SKIP] {e}', file=sys.stderr)

    if dry_run:
        for uid, item in items.items():
            print(f'  {uid}: name={item["name"]}, role={item["role"]}, '
                  f'score={item["score"]}, friends={item["friends"]}')
        print(f'\nDry run complete. {len(items)} users would be migrated.')
        return

    dynamodb = boto3.resource('dynamodb', region_name=region)
    table = dynamodb.Table(table_name)

    try:
        table.load()
    except ClientError as e:
        print(f'Error: cannot access table "{table_name}": {e}', file=sys.stderr)
        sys.exit(1)

    succeeded, failed = 0, 0
    with table.batch_writer() as batch:
        for uid, item in items.items():
            try:
                batch.put_item(Item=item)
                succeeded += 1
                print(f'  [ok] {uid}')
            except ClientError as e:
                failed += 1
                print(f'  [FAIL] {uid}: {e}', file=sys.stderr)

    print(f'\nMigration complete: {succeeded} succeeded, {failed} failed.')
    if failed:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description='Migrate users to DynamoDB')
    parser.add_argument('--file', default='data/users.json',
                        help='Source JSON file (default: data/users.json)')
    parser.add_argument('--region', default=os.environ.get('AWS_REGION', 'us-east-1'),
                        help='AWS region (default: $AWS_REGION or us-east-1)')
    parser.add_argument('--table', default=os.environ.get('USERS_TABLE', 'gamehub-users'),
                        help='DynamoDB table name (default: $USERS_TABLE or gamehub-users)')
    parser.add_argument('--dry-run', action='store_true',
                        help='Preview migration without writing to DynamoDB')
    args = parser.parse_args()

    migrate(args.file, args.region, args.table, args.dry_run)


if __name__ == '__main__':
    main()
