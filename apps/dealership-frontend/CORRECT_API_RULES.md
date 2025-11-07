# ⚠️ CORRECT API RULES for PocketBase

## The Problem

I previously told you to set ALL rules to just `@request.auth.id != ""` (any authenticated user).

This was **TOO SIMPLE** and doesn't give managers the proper permissions to manage users!

---

## ✅ CORRECT RULES (Apply These Now)

### Collection: `users`

| Rule | Formula |
|------|---------|
| **ListRule** | `@request.auth.id != ""` |
| **ViewRule** | `@request.auth.id != ""` |
| **CreateRule** | `@request.auth.role = "manager"` |
| **UpdateRule** | `@request.auth.role = "manager"` |
| **DeleteRule** | `@request.auth.role = "manager"` |

**Why**: 
- Any authenticated user can LIST and VIEW users (needed for UI)
- Only MANAGERS can CREATE, UPDATE, DELETE users (Team Management)

---

### Collection: `salespeople`

| Rule | Formula |
|------|---------|
| **ListRule** | `@request.auth.id != ""` |
| **ViewRule** | `@request.auth.id != ""` |
| **CreateRule** | `@request.auth.role = "manager"` |
| **UpdateRule** | `@request.auth.role = "manager"` |
| **DeleteRule** | `@request.auth.role = "manager"` |

**Why**:
- Everyone can see salespeople list
- Only managers can create/edit/delete salesperson profiles

---

### Collection: `sales`

| Rule | Formula |
|------|---------|
| **ListRule** | `@request.auth.id != ""` |
| **ViewRule** | `@request.auth.id != ""` |
| **CreateRule** | `@request.auth.id != ""` |
| **UpdateRule** | `@request.auth.role = "manager"` |
| **DeleteRule** | `@request.auth.role = "manager"` |

**Why**:
- Any authenticated user can list/view (filtered by UI based on role)
- ANY authenticated user can CREATE (salespeople save their own sessions)
- Only managers can UPDATE/DELETE sales records

---

### Collection: `live_sales`

| Rule | Formula |
|------|---------|
| **ListRule** | `@request.auth.id != ""` |
| **ViewRule** | `@request.auth.id != ""` |
| **CreateRule** | `@request.auth.id != ""` |
| **UpdateRule** | `@request.auth.id != ""` |
| **DeleteRule** | `@request.auth.role = "manager"` |

**Why**:
- Everyone can see live sales (for real-time monitoring)
- Salespeople can CREATE and UPDATE their own live sessions
- Only managers can DELETE

---

## 🔧 How to Apply (Step-by-Step)

1. **Open PocketBase Admin**: https://even-terry-exactly-unique.trycloudflare.com/_/

2. **For `users` collection**:
   - Click "users" → "API Rules" tab
   - Set rules EXACTLY as shown above
   - **ListRule**: `@request.auth.id != ""`
   - **ViewRule**: `@request.auth.id != ""`
   - **CreateRule**: `@request.auth.role = "manager"`
   - **UpdateRule**: `@request.auth.role = "manager"`
   - **DeleteRule**: `@request.auth.role = "manager"`
   - Click "Save"

3. **For `salespeople` collection**:
   - Same as users (see table above)
   - Click "Save"

4. **For `sales` collection**:
   - **ListRule**: `@request.auth.id != ""`
   - **ViewRule**: `@request.auth.id != ""`
   - **CreateRule**: `@request.auth.id != ""` ← IMPORTANT: Any user can create
   - **UpdateRule**: `@request.auth.role = "manager"`
   - **DeleteRule**: `@request.auth.role = "manager"`
   - Click "Save"

5. **For `live_sales` collection**:
   - **ListRule**: `@request.auth.id != ""`
   - **ViewRule**: `@request.auth.id != ""`
   - **CreateRule**: `@request.auth.id != ""`
   - **UpdateRule**: `@request.auth.id != ""`
   - **DeleteRule**: `@request.auth.role = "manager"`
   - Click "Save"

---

## ✅ What This Enables

### Manager Can:
- ✅ View all users
- ✅ Create new users (Team Management)
- ✅ Edit users (change email/role)
- ✅ Delete users
- ✅ Manage salespeople profiles
- ✅ View all sales
- ✅ Edit/delete sales records
- ✅ Monitor live sessions

### Salesperson Can:
- ✅ View users list (to see team)
- ✅ View salespeople
- ✅ **Create sales records** (save their sessions!)
- ✅ View their own sales
- ✅ Create/update live sales (their active sessions)
- ❌ Cannot create/edit/delete users
- ❌ Cannot edit other people's sales
- ❌ Cannot delete anything

---

## 🔍 Testing After Applying Rules

Run this to verify:

```bash
npm run dev
```

Then test:

1. **Log in as Manager**:
   - Go to Team Management
   - Try creating a new user → Should work ✅
   - Try editing a user → Should work ✅
   - Try deleting a user → Should work ✅

2. **Log in as Salesperson**:
   - Go to Record tab
   - Record a test session
   - End recording
   - Should see "Session saved successfully!" ✅
   - Check PocketBase Admin → sales collection → Should have record ✅

3. **Manager sees salesperson's session**:
   - Log back in as manager
   - Check sales history
   - Should see the salesperson's session ✅

---

## 🐛 If You Get Errors

### "Failed to create user"
- Check: CreateRule for `users` = `@request.auth.role = "manager"`
- Check: You're logged in as manager (not salesperson)

### "Failed to save session"
- Check: CreateRule for `sales` = `@request.auth.id != ""` (NOT requiring manager role)
- Check: You're logged in (any user)

### "Failed to authenticate"
- Check: All ListRule and ViewRule = `@request.auth.id != ""`
- Try: Log out and log back in

---

## 📝 Quick Copy-Paste Rules

For convenience, here are the exact formulas to copy:

**For Manager-only actions** (Create/Update/Delete users):
```
@request.auth.role = "manager"
```

**For any authenticated user** (List, View, Create sales):
```
@request.auth.id != ""
```

---

## 💡 Why This Works

1. **Security**: Only authenticated users can access any data
2. **Role-based**: Managers have elevated privileges for user management
3. **Flexible**: Salespeople can save their own sessions without manager approval
4. **Filtering**: UI handles showing users only their own data (managers see all)

This is the CORRECT configuration! Apply these rules now and test again.
