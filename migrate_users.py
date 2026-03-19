#!/usr/bin/env python3
"""
Migrate users from logged_in field to status field in DynamoDB.
Replace 'logged_in' with 'status' (offline/online/chilling).
"""

import boto3
import json
from decimal import Decimal

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
table = dynamodb.Table('Users')

with open('data/users.json', 'r') as f:
    users = json.load(f)

with table.batch_writer(batch_size=25) as batch:
    for uid, data in users.items():
        item = {'user_id': uid, **data}
        item.pop('logged_in', None)
        item['status'] = 'offline'
        item['public_ip'] = ''
        item.setdefault('role', 'user')
        item.setdefault('name', '')
        item.setdefault('email', '')
        batch.put_item(Item=item)

print(f"Migrated {len(users)} users")
