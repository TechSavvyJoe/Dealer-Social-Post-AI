# Adding Name Field to PocketBase Users Collection

## Quick Steps

### 1. Open PocketBase Admin
Go to: https://even-terry-exactly-unique.trycloudflare.com/_/

### 2. Navigate to Users Collection
- Click on **"Collections"** in the left sidebar
- Click on **"users"** collection

### 3. Add Name Field
1. Click on **"Fields"** tab
2. Click **"New field"** button
3. Select field type: **"Text"**
4. Configure the field:
   - **Name**: `name`
   - **Label**: `Name` (optional)
   - **Min length**: Leave empty (optional)
   - **Max length**: Leave empty (or set to 100)
   - **Pattern**: Leave empty
   - **Required**: ❌ **UNCHECKED** (name is optional)
   - **Unique**: ❌ **UNCHECKED**

5. Click **"Save"** to add the field

### 4. That's It!

The app is already configured to:
- ✅ Use name field when creating new users
- ✅ Display name prominently in the UI
- ✅ Show email as secondary identifier
- ✅ Fall back to email prefix if name is not provided

## What Will Change

### Before (Current):
```
Manager Hub
Welcome back, manager@test.com!

Team Members:
└─ manager@test.com (email)
   └─ Manager
```

### After (With Name Field):
```
Manager Hub
Welcome back, John Smith!

Team Members:
└─ John Smith (name - prominent)
   └─ manager@test.com (email - secondary)
   └─ Manager (role)
```

## Default Behavior

If you don't provide a name when creating a user:
- The app will automatically use the part before @ in the email
- Example: `john.doe@dealership.com` → Name: `john.doe`

## Testing the Change

After adding the field in PocketBase:

1. **Fix the authentication issue first** (apply correct API rules)
2. Log in to your app
3. Go to **Team Management**
4. Create a new user and fill in the **Name** field
5. The name will display prominently in:
   - Manager Hub welcome message
   - Team Management list
   - Any user displays

## Editing Existing Users

After adding the field, you can:

1. Go to **Team Management** tab
2. Click **Edit** on any user
3. Add/update their name
4. Click **Update User**

Or manually in PocketBase Admin:
1. Go to users collection
2. Click on a user record
3. Add a value to the `name` field
4. Save

## API Rules Note

The name field will follow the same API rules as other user fields:
- **List/View**: Any authenticated user can see names
- **Create**: Only managers can create users (with names)
- **Update**: Only managers can update user names
- **Delete**: Only managers can delete users

No additional configuration needed!
