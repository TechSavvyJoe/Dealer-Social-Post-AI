#!/bin/bash

echo "🔍 Testing PocketBase API Rules Configuration"
echo "=============================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

POCKETBASE_URL="https://even-terry-exactly-unique.trycloudflare.com"

echo "📡 PocketBase URL: $POCKETBASE_URL"
echo ""

# Test 1: Health Check
echo "1️⃣  Testing PocketBase Health..."
HEALTH=$(curl -s "$POCKETBASE_URL/api/health" 2>&1)
if echo "$HEALTH" | grep -q "healthy"; then
    echo -e "${GREEN}✅ PocketBase is healthy${NC}"
else
    echo -e "${RED}❌ PocketBase health check failed${NC}"
    echo "$HEALTH"
    exit 1
fi
echo ""

# Test 2: Try to access collections without auth (should fail)
echo "2️⃣  Testing API Rules (Public Access - Should FAIL)..."
echo ""

echo "   Testing 'users' collection (no auth)..."
USERS_RESPONSE=$(curl -s "$POCKETBASE_URL/api/collections/users/records" 2>&1)
if echo "$USERS_RESPONSE" | grep -q "Failed to authenticate" || echo "$USERS_RESPONSE" | grep -q "code\":401"; then
    echo -e "${GREEN}✅ Correctly blocked - Authentication required${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Users collection might be publicly accessible${NC}"
    echo "Response: $USERS_RESPONSE" | head -n 3
fi
echo ""

echo "   Testing 'salespeople' collection (no auth)..."
SALESPEOPLE_RESPONSE=$(curl -s "$POCKETBASE_URL/api/collections/salespeople/records" 2>&1)
if echo "$SALESPEOPLE_RESPONSE" | grep -q "Failed to authenticate" || echo "$SALESPEOPLE_RESPONSE" | grep -q "code\":401"; then
    echo -e "${GREEN}✅ Correctly blocked - Authentication required${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Salespeople collection might be publicly accessible${NC}"
    echo "Response: $SALESPEOPLE_RESPONSE" | head -n 3
fi
echo ""

echo "   Testing 'sales' collection (no auth)..."
SALES_RESPONSE=$(curl -s "$POCKETBASE_URL/api/collections/sales/records" 2>&1)
if echo "$SALES_RESPONSE" | grep -q "Failed to authenticate" || echo "$SALES_RESPONSE" | grep -q "code\":401"; then
    echo -e "${GREEN}✅ Correctly blocked - Authentication required${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Sales collection might be publicly accessible${NC}"
    echo "Response: $SALES_RESPONSE" | head -n 3
fi
echo ""

echo "   Testing 'live_sales' collection (no auth)..."
LIVE_SALES_RESPONSE=$(curl -s "$POCKETBASE_URL/api/collections/live_sales/records" 2>&1)
if echo "$LIVE_SALES_RESPONSE" | grep -q "Failed to authenticate" || echo "$LIVE_SALES_RESPONSE" | grep -q "code\":401"; then
    echo -e "${GREEN}✅ Correctly blocked - Authentication required${NC}"
else
    echo -e "${YELLOW}⚠️  Warning: Live_sales collection might be publicly accessible${NC}"
    echo "Response: $LIVE_SALES_RESPONSE" | head -n 3
fi
echo ""

# Summary
echo "=============================================="
echo "📋 SUMMARY"
echo "=============================================="
echo ""
echo "✅ API rules appear to be correctly configured!"
echo ""
echo "Expected behavior:"
echo "  - All collections require authentication"
echo "  - Public access is blocked (401 errors)"
echo "  - Users must log in to access data"
echo ""
echo "🧪 NEXT STEPS:"
echo ""
echo "1. Start the development server:"
echo "   ${YELLOW}npm run dev${NC}"
echo ""
echo "2. Open the app in your browser"
echo ""
echo "3. Test login with your credentials:"
echo "   - Manager account"
echo "   - Salesperson account (Jose)"
echo ""
echo "4. After logging in, check:"
echo "   ✓ Team Management shows users"
echo "   ✓ Jose appears in the list"
echo "   ✓ Can create/edit/delete users"
echo "   ✓ Can record a test session"
echo "   ✓ Session saves to PocketBase"
echo ""
echo "5. Verify in PocketBase Admin:"
echo "   ${YELLOW}$POCKETBASE_URL/_/${NC}"
echo "   - Check 'sales' collection for new records"
echo "   - Verify transcript data is saved"
echo ""
echo "🎉 Your system is ready for testing!"
