# Fixing Dealer Code Login

## Problem

The dealers collection was missing a `code` field to store 4-digit login codes (0000, 1111, 2222, etc.). The app was trying to look up dealers by PocketBase record ID instead of by code.

## Solution

### Step 1: Add the `code` field to the dealers collection

Run this script to add the `code` field and fix API rules:

```bash
PB_URL="https://dealer-social-post-ai-production.fly.dev" \
PB_ADMIN_EMAIL="your-admin@email.com" \
PB_ADMIN_PASSWORD="your-password" \
node scripts/add_dealer_code_field.js
```

### Step 2: Assign codes to your dealers

Option A - **Automatic assignment** (assigns 0000, 1111, 2222, etc.):

```bash
PB_URL="https://dealer-social-post-ai-production.fly.dev" \
PB_ADMIN_EMAIL="your-admin@email.com" \
PB_ADMIN_PASSWORD="your-password" \
node scripts/populate_dealer_codes.js
```

Option B - **Manual assignment** via PocketBase Admin UI:

1. Go to `https://dealer-social-post-ai-production.fly.dev/_/`
2. Login as admin
3. Go to Collections → dealers
4. Click on each dealer record
5. Set the `code` field to a 4-digit number (e.g., "0000", "1234")
6. Save

### Step 3: Test login

1. Open your app: `https://dealer-social-post-ai-production.fly.dev`
2. Enter a dealer code (e.g., "0000")
3. You should now be able to login!

## What Changed

1. **Database Schema**: Added a `code` field to the dealers collection (4-digit text field)
2. **API Rules**: Set `listRule` and `viewRule` to empty string to allow public read access (needed for login)
3. **Code**: Updated `findDealer()` to search by code instead of PocketBase record ID

## For Local Development

Use `http://127.0.0.1:8090` as the PB_URL:

```bash
PB_URL="http://127.0.0.1:8090" \
PB_ADMIN_EMAIL="your-admin@email.com" \
PB_ADMIN_PASSWORD="your-password" \
node scripts/add_dealer_code_field.js

PB_URL="http://127.0.0.1:8090" \
PB_ADMIN_EMAIL="your-admin@email.com" \
PB_ADMIN_PASSWORD="your-password" \
node scripts/populate_dealer_codes.js
```
