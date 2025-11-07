# 🎯 Step-by-Step: Apply Correct API Rules in PocketBase

## You're Right - I Made a Mistake!

The previous rules (`@request.auth.id != ""` for everything) were **too simple** and broke manager permissions.

Here are the **CORRECT** rules that restore full functionality:

---

## 📝 Quick Reference Card

### Collection: `users`
```
ListRule:   @request.auth.id != ""
ViewRule:   @request.auth.id != ""
CreateRule: @request.auth.role = "manager"  ← Manager only!
UpdateRule: @request.auth.role = "manager"  ← Manager only!
DeleteRule: @request.auth.role = "manager"  ← Manager only!
```

### Collection: `salespeople`
```
ListRule:   @request.auth.id != ""
ViewRule:   @request.auth.id != ""
CreateRule: @request.auth.role = "manager"  ← Manager only!
UpdateRule: @request.auth.role = "manager"  ← Manager only!
DeleteRule: @request.auth.role = "manager"  ← Manager only!
```

### Collection: `sales`
```
ListRule:   @request.auth.id != ""
ViewRule:   @request.auth.id != ""
CreateRule: @request.auth.id != ""          ← Any user! (salespeople save sessions)
UpdateRule: @request.auth.role = "manager"  ← Manager only!
DeleteRule: @request.auth.role = "manager"  ← Manager only!
```

### Collection: `live_sales`
```
ListRule:   @request.auth.id != ""
ViewRule:   @request.auth.id != ""
CreateRule: @request.auth.id != ""          ← Any user!
UpdateRule: @request.auth.id != ""          ← Any user!
DeleteRule: @request.auth.role = "manager"  ← Manager only!
```

---

## 🔧 How to Apply (Click-by-Click)

### Step 1: Open PocketBase Admin
1. Go to: https://even-terry-exactly-unique.trycloudflare.com/_/
2. Log in if needed

### Step 2: Configure `users` Collection
1. Click **"Collections"** in left sidebar (if not already there)
2. Click **"users"** collection
3. Click **"API Rules"** tab (top of page)
4. You'll see 5 input fields (one for each rule)
5. **Fill them in:**
   - **List** field: `@request.auth.id != ""`
   - **View** field: `@request.auth.id != ""`
   - **Create** field: `@request.auth.role = "manager"`
   - **Update** field: `@request.auth.role = "manager"`
   - **Delete** field: `@request.auth.role = "manager"`
6. Click **"Save changes"** button (bottom right)
7. ✅ Done with `users`!

### Step 3: Configure `salespeople` Collection
1. Click **"salespeople"** in collections list (left sidebar)
2. Click **"API Rules"** tab
3. **Fill in same rules as `users`:**
   - **List**: `@request.auth.id != ""`
   - **View**: `@request.auth.id != ""`
   - **Create**: `@request.auth.role = "manager"`
   - **Update**: `@request.auth.role = "manager"`
   - **Delete**: `@request.auth.role = "manager"`
4. Click **"Save changes"**
5. ✅ Done with `salespeople`!

### Step 4: Configure `sales` Collection
1. Click **"sales"** in collections list
2. Click **"API Rules"** tab
3. **IMPORTANT - Different rules!**
   - **List**: `@request.auth.id != ""`
   - **View**: `@request.auth.id != ""`
   - **Create**: `@request.auth.id != ""` ← **NOT manager-only!**
   - **Update**: `@request.auth.role = "manager"`
   - **Delete**: `@request.auth.role = "manager"`
4. Click **"Save changes"**
5. ✅ Done with `sales`!

### Step 5: Configure `live_sales` Collection
1. Click **"live_sales"** in collections list
2. Click **"API Rules"** tab
3. **Fill in:**
   - **List**: `@request.auth.id != ""`
   - **View**: `@request.auth.id != ""`
   - **Create**: `@request.auth.id != ""`
   - **Update**: `@request.auth.id != ""`
   - **Delete**: `@request.auth.role = "manager"`
4. Click **"Save changes"**
5. ✅ Done with `live_sales`!

---

## ✅ Verification Checklist

After applying all rules, verify you did it correctly:

- [ ] `users` collection - Create/Update/Delete = `@request.auth.role = "manager"`
- [ ] `salespeople` collection - Create/Update/Delete = `@request.auth.role = "manager"`
- [ ] `sales` collection - Create = `@request.auth.id != ""` (NOT manager-only!)
- [ ] `live_sales` collection - Create/Update = `@request.auth.id != ""`

---

## 🧪 Test After Applying

### Test 1: Manager Can Create Users
```bash
npm run dev
```

1. Log in as manager
2. Go to Team Management
3. Click "Add User"
4. Create a test user
5. **Expected**: Should work! ✅

### Test 2: Salesperson Can Save Sessions
1. Log in as salesperson
2. Go to Record tab
3. Record 10 seconds of audio
4. Click stop
5. **Expected**: "Session saved successfully!" ✅

### Test 3: Verify Data Saved
1. Open PocketBase Admin
2. Go to Collections → `sales`
3. **Expected**: See the session record ✅

---

## 🎯 What These Rules Enable

| Action | Manager | Salesperson |
|--------|---------|-------------|
| View users | ✅ Yes | ✅ Yes |
| Create user | ✅ Yes | ❌ No |
| Edit user | ✅ Yes | ❌ No |
| Delete user | ✅ Yes | ❌ No |
| View sales | ✅ All | ✅ Own only (UI filter) |
| **Create sale** | ✅ Yes | ✅ **Yes!** |
| Edit sale | ✅ Yes | ❌ No |
| Delete sale | ✅ Yes | ❌ No |
| Monitor live | ✅ All | ✅ Own |
| Create live session | ✅ Yes | ✅ Yes |
| Update live session | ✅ Yes | ✅ Yes |

---

## 💡 Why This Is Correct

**The Key Insight:**
- Salespeople need to **create sales records** when they end a session
- But only managers should **create/edit/delete USER accounts**

**Previous (Wrong) Rules:**
- Everything required just authentication
- Managers couldn't manage users (missing role check)

**Current (Correct) Rules:**
- User management = Manager role required
- Sales creation = Any authenticated user
- Editing/deleting = Manager only

This gives managers full control while allowing salespeople to do their job! 🎉

---

## 📞 Need Help?

If you get errors after applying:

1. **"Failed to create user"** → Check CreateRule for `users` = `@request.auth.role = "manager"`
2. **"Failed to save session"** → Check CreateRule for `sales` = `@request.auth.id != ""`
3. **Can't see users** → Check ListRule for `users` = `@request.auth.id != ""`

Just run `./verify-correct-rules.sh` to see the rules summary again!
