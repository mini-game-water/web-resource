"""One-time script to migrate data/users.json to DynamoDB gamehub-users table."""
import json
import os

import boto3

REGION = os.environ.get('AWS_REGION', 'us-east-1')
TABLE_NAME = os.environ.get('USERS_TABLE', 'gamehub-users')

dynamodb = boto3.resource('dynamodb', region_name=REGION)
table = dynamodb.Table(TABLE_NAME)


def migrate():
    with open('data/users.json', 'r', encoding='utf-8') as f:
        users = json.load(f)

    with table.batch_writer() as batch:
        for uid, data in users.items():
            item = {'user_id': uid, **data}
            # Ensure logged_in is reset on migration
            item['logged_in'] = False
            item['public_ip'] = ''
            batch.put_item(Item=item)
            print(f'  Migrated user: {uid}')

    print(f'Done. {len(users)} users migrated to {TABLE_NAME}.')


if __name__ == '__main__':
    migrate()
