# PocketBase API Rules - Quick Setup Guide

## 🎯 Access PocketBase Admin

1. Open: `https://even-terry-exactly-unique.trycloudflare.com/_/`
2. Log in with your admin credentials
3. Go to **Collections** → **users**
4. Click **API Rules** tab

---

## 📋 Copy & Paste These Rules

### 1. ListRule (Who can see the list of users)
```javascript
@request.auth.id != "" && @request.auth.role = "manager"
```

### 2. ViewRule (Who can view individual user details)
```javascript
@request.auth.id != "" && (@request.auth.id = id || @request.auth.role = "manager")
```

### 3. CreateRule (Who can create new users)
```javascript
@request.auth.id != "" && @request.auth.role = "manager"
```

### 4. UpdateRule (Who can update users)
```javascript
@request.auth.id != "" && @request.auth.role = "manager"
```

### 5. DeleteRule (Who can delete users)
```javascript
@request.auth.id != "" && @request.auth.role = "manager"
```

---

## ✅ What These Rules Do

- **Only managers** can create, list, update, or delete users
- **All authenticated users** can view their own profile
- **Managers** can view anyone's profile
- **Prevents unauthorized access** to user management

---

## 🔧 Alternative: Open Rules for Testing

⚠️ **USE ONLY FOR LOCAL TESTING - NOT PRODUCTION!**

If you want to test without restrictions (temporarily):

Set ALL rules to:
```javascript
@request.auth.id != ""
```

This allows any authenticated user to perform any action.

**Remember to change back to manager-only rules before deploying!**

---

## 🧪 How to Test After Setting Rules

1. **Save the API rules** in PocketBase Admin
2. **Start your dev server**: `npm run dev`
3. **Log in as a manager**
4. **Go to Team Management tab**
5. **Try creating a user** - should work ✅
6. **Log out and log in as salesperson**
7. **Go to Team Management tab** - should see error or empty list ✅

---

## 🐛 Troubleshooting

### "Failed to load users" error
- Check console for specific error message
- Verify you're logged in as a manager
- Check PocketBase API rules are saved
- Verify ListRule is set correctly

### "Failed to create user" error
- Check if email already exists
- Verify password is at least 8 characters
- Check CreateRule allows managers
- Look at browser console for PocketBase response

### Users collection not found
- In PocketBase Admin, verify `users` collection exists
- Check that `role` field is configured as Select type
- Ensure `role` has options: 'manager', 'salesman'

---

## 📝 Field Configuration Checklist

In PocketBase Admin → Collections → users:

- [x] **email** field (Email type, Required, Unique)
- [x] **password** field (Password type, Required, Min: 8)
- [x] **role** field (Select type, Required, Options: 'manager', 'salesman')
- [x] **Auth collection** enabled
- [x] **API Rules** configured (see above)

---

## 🚀 After Configuration

Once you've set up the API rules:

1. The User Management feature will work perfectly
2. All CRUD operations will sync with PocketBase
3. Changes in the UI will immediately update the database
4. Changes in PocketBase Admin will be visible after refresh

**Your integration is complete!** 🎉
