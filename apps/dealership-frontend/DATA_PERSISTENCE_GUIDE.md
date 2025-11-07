# Complete PocketBase Data Flow & Persistence Guide

## 🗄️ Database Schema Overview

Your PocketBase database has 4 collections that store ALL application data:

```
┌─────────────┐
│    users    │  ← Authentication accounts (login credentials)
└──────┬──────┘
       │
       │ user_id (foreign key)
       ↓
┌─────────────┐
│ salespeople │  ← Salesperson profiles
└──────┬──────┘
       │
       │ salesperson_id (foreign key)
       ├────────────────┬────────────────┐
       ↓                ↓                ↓
┌─────────────┐  ┌──────────────┐  ┌───────────────┐
│    sales    │  │  live_sales  │  │ Other records │
└─────────────┘  └──────────────┘  └───────────────┘
```

---

## 📊 Collection 1: `users`

### Purpose
Stores user accounts for authentication and login.

### Data Saved
```javascript
{
  id: "abc123xyz",              // Auto-generated
  email: "jose@example.com",    // Login email
  password: "***HASHED***",     // Encrypted password (never visible)
  role: "salesman",             // or "manager"
  created: "2025-11-06T...",    // Auto-generated
  updated: "2025-11-06T...",    // Auto-updated
  emailVisibility: true         // Can other users see email
}
```

### When Data is Saved
- ✅ **User Registration**: When creating new user from Team Management
- ✅ **User Update**: When editing user email or role
- ✅ **Delete**: When removing user from Team Management

### Who Can Access
- **Manager**: All users (full CRUD)
- **Salesperson**: Own record only (view)

### Frontend Integration
```typescript
// Create user (Team Management → Add User button)
await createUser(email, password, role);
// Saves to: PocketBase users collection

// Update user (Team Management → Edit button)
await updateUser(id, email, role);
// Updates in: PocketBase users collection

// Delete user (Team Management → Delete button)
await deleteUser(id);
// Removes from: PocketBase users collection

// View users (Team Management tab)
await getAllUsers();
// Fetches from: PocketBase users collection
```

---

## 📊 Collection 2: `salespeople`

### Purpose
Stores salesperson profiles and performance data.

### Data Saved
```javascript
{
  id: "salesperson123",
  user_id: "abc123xyz",         // Links to users collection
  name: "Jose Martinez",        // Display name
  performance_metrics: {        // Performance tracking
    total_sales: 150,
    success_rate: 0.75,
    average_score: 85
  },
  created: "2025-11-06T...",
  updated: "2025-11-06T..."
}
```

### When Data is Saved
- ✅ **Profile Creation**: When salesperson profile is created
- ✅ **Performance Update**: After each sale is completed
- ✅ **Manual Update**: When editing salesperson info

### Who Can Access
- **Manager**: All salespeople (full access)
- **Salesperson**: Can see all (read-only for others, edit own)

### Frontend Integration
```typescript
// Load salespeople (Manager Dashboard)
await getSalespeople();
// Fetches from: PocketBase salespeople collection

// Create salesperson
await createSalesperson({ user_id, name, performance_metrics });
// Saves to: PocketBase salespeople collection
```

---

## 📊 Collection 3: `sales`

### Purpose
**MOST IMPORTANT** - Stores complete sales history and recordings.

### Data Saved
```javascript
{
  id: "sale456",
  salesperson_id: "salesperson123",  // Who made the sale
  customer_name: "John Smith",       // Customer info
  
  // COMPLETE CONVERSATION RECORDING
  transcript: {
    segments: [
      {
        speaker: "salesman",
        text: "Hello, how can I help you?",
        timestamp: "00:00:05",
        sentiment: "positive"
      },
      {
        speaker: "customer",
        text: "I'm interested in buying a car",
        timestamp: "00:00:10",
        sentiment: "neutral"
      }
      // ... full conversation
    ],
    duration: "00:15:30",
    word_count: 2500
  },
  
  // AI ANALYSIS
  analysis: {
    sales_step: "Closing",
    key_topics: ["financing", "trade-in", "warranty"],
    objections_raised: ["price", "timing"],
    objections_handled: ["price"],
    customer_sentiment: "positive",
    engagement_level: "high",
    buying_signals: ["asked about payment plans", "mentioned trade-in"]
  },
  
  // PERFORMANCE REPORT
  performance_report: {
    overall_score: 85,
    step_scores: {
      greeting: 90,
      needs_discovery: 80,
      presentation: 85,
      handling_objections: 75,
      closing: 88
    },
    strengths: [
      "Excellent rapport building",
      "Good product knowledge"
    ],
    improvements: [
      "Could handle objections more assertively",
      "Ask more open-ended questions"
    ],
    coaching_tips: [
      "Practice SPIN selling technique",
      "Use more trial closes"
    ]
  },
  
  success_probability: 0.85,  // 85% chance of closing
  
  created: "2025-11-06T...",
  updated: "2025-11-06T..."
}
```

### When Data is Saved
- ✅ **During Live Call**: Transcript updates in real-time
- ✅ **After Call Ends**: Complete record saved with all data
- ✅ **AI Analysis**: Analysis and performance report generated and saved
- ✅ **Manual Entry**: Can create historical sales records

### Who Can Access
- **Manager**: ALL sales from ALL salespeople
- **Salesperson**: ONLY their own sales (salesperson_id matches)

### Frontend Integration
```typescript
// View sales history (Manager: all, Salesperson: own)
await getRecentSales(limit);
// Fetches from: PocketBase sales collection
// Filters automatically based on user role

// View specific sale details
await getSaleById(id);
// Fetches from: PocketBase sales collection
// Returns: Full transcript, analysis, performance report

// Create new sale
await createSale({
  salesperson_id,
  customer_name,
  transcript,
  analysis,
  performance_report,
  success_probability
});
// Saves to: PocketBase sales collection
```

### Data Persistence
- ✅ Transcripts: PERMANENTLY saved
- ✅ Analysis: PERMANENTLY saved
- ✅ Performance reports: PERMANENTLY saved
- ✅ Can be retrieved ANY time for review
- ✅ Used for historical analytics
- ✅ Used for training and coaching

---

## 📊 Collection 4: `live_sales`

### Purpose
Tracks active/ongoing sales calls in real-time.

### Data Saved
```javascript
{
  id: "live789",
  salesperson_id: "salesperson123",
  customer_name: "Jane Doe",
  status: "active",             // or "ended"
  started_at: "2025-11-06T10:30:00Z",
  ended_at: null,               // Set when call ends
  
  // Real-time data (updates during call)
  current_step: "Presentation",
  duration: "00:05:23",
  alerts: [
    {
      type: "coaching",
      message: "Customer mentioned price - address objection",
      timestamp: "00:04:15"
    }
  ],
  
  created: "2025-11-06T...",
  updated: "2025-11-06T..."     // Updates continuously
}
```

### When Data is Saved
- ✅ **Call Start**: When salesperson starts new call
- ✅ **During Call**: Real-time updates (status, alerts, progress)
- ✅ **Call End**: Final status and end time saved
- ✅ **After Call**: Record moves to `sales` collection (archived)

### Who Can Access
- **Manager**: ALL active calls (live monitoring)
- **Salesperson**: ONLY their own active call

### Frontend Integration
```typescript
// Start live sale
await startLiveSale(salespersonId, customerName);
// Creates record in: PocketBase live_sales collection

// Monitor live sales (Manager Dashboard - real-time)
await subscribeLiveSales((sales) => {
  // Updates automatically when ANY call status changes
  setLiveSales(sales);
});
// Subscribes to: PocketBase live_sales collection

// End live sale
await endLiveSale(id);
// Updates record in: PocketBase live_sales collection
// Then creates final record in: PocketBase sales collection
```

---

## 🔄 Complete User Flow with Data Persistence

### Flow 1: New User Creation
```
1. Manager clicks "Add User" in Team Management
   ↓
2. Fills form: email, password, role
   ↓
3. Clicks "Create User"
   ↓
4. Frontend: createUser(email, password, role)
   ↓
5. PocketBase: Saves to users collection
   ↓
6. Frontend: loadUsers() - refreshes list
   ↓
7. User appears in Team Management
   ↓
8. PERSISTENT: User can now log in!
```

### Flow 2: Sales Call with Full Recording
```
1. Salesperson logs in, clicks "Start New Call"
   ↓
2. Enters customer name
   ↓
3. Frontend: startLiveSale(salespersonId, customerName)
   ↓
4. PocketBase: Creates record in live_sales
   ↓
5. Manager Dashboard: Shows live call in real-time
   ↓
6. DURING CALL:
   - Microphone records audio
   - Speech-to-text creates transcript
   - AI analyzes in real-time
   - Coaching alerts generated
   - All updates save to live_sales
   ↓
7. Salesperson clicks "End Call"
   ↓
8. Frontend: endLiveSale(id)
   ↓
9. Backend Processing:
   - Final AI analysis
   - Performance report generation
   - Success probability calculation
   ↓
10. Frontend: createSale({
      salesperson_id,
      customer_name,
      transcript,      ← FULL RECORDING
      analysis,        ← AI INSIGHTS
      performance_report  ← COACHING FEEDBACK
    })
    ↓
11. PocketBase: Saves complete record to sales collection
    ↓
12. PERSISTENT: Sale now appears in history!
    - Manager can view it anytime
    - Salesperson can review their own call
    - Transcript is searchable
    - Performance metrics tracked
```

### Flow 3: Viewing Historical Data
```
1. User opens Dashboard
   ↓
2. Frontend: getRecentSales()
   ↓
3. PocketBase: Queries sales collection
   - Manager: Returns ALL sales
   - Salesperson: Returns only their sales
   ↓
4. Frontend: Displays sales history
   ↓
5. User clicks on a specific sale
   ↓
6. Frontend: getSaleById(id)
   ↓
7. PocketBase: Returns complete record:
   - Full transcript
   - AI analysis
   - Performance report
   - Customer info
   ↓
8. Frontend: Displays:
   - Transcript viewer (conversation replay)
   - Performance metrics
   - Coaching tips
   - Customer sentiment analysis
```

---

## ✅ What is PERMANENTLY Saved

### User Data (Forever)
- ✅ User accounts
- ✅ Login credentials
- ✅ Roles (manager/salesman)

### Salesperson Data (Forever)
- ✅ Profiles
- ✅ Performance metrics
- ✅ Historical statistics

### Sales Data (Forever)
- ✅ **COMPLETE call transcripts** (every word spoken)
- ✅ **AI analysis** (objections, sentiment, topics)
- ✅ **Performance reports** (scores, strengths, improvements)
- ✅ **Customer information**
- ✅ **Timestamps** (when call occurred)
- ✅ **Success probability**
- ✅ **Coaching tips**

### Live Data (Temporary → Archived)
- ⏱️ Live calls (while active)
- ✅ After call ends → Moved to permanent sales collection

---

## 📈 Role-Based Data Access

### Manager Can See
- ✅ ALL users
- ✅ ALL salespeople
- ✅ ALL sales (from all salespeople)
- ✅ ALL live calls (real-time monitoring)
- ✅ Complete transcripts and analysis for any sale
- ✅ Team performance analytics

### Salesperson Can See
- ✅ Their own user account
- ✅ Their own sales history
- ✅ Their own active call
- ✅ Their own transcripts and performance reports
- ❌ Cannot see other salespeople's calls
- ❌ Cannot see other salespeople's data

---

## 🔒 Data Security

### Encryption
- ✅ Passwords: Bcrypt hashed (never stored plain text)
- ✅ API: HTTPS encrypted in transit
- ✅ Auth tokens: Secure JWT tokens

### Access Control
- ✅ API Rules: Enforce authentication
- ✅ Role-based filtering: Automatic in backend
- ✅ UI restrictions: Prevent unauthorized access

---

## 🧪 Testing Data Persistence

Run these tests to verify everything saves:

1. **Create a user** → Check PocketBase Admin → Should be in `users`
2. **Make a test call** → End call → Check `sales` collection → Should have full transcript
3. **Log out and back in** → Check sales history → Should still be there
4. **Different browser** → Log in as same user → Should see same data
5. **Restart PocketBase** → All data should persist

---

## 📊 Summary

| Collection | What's Saved | When | Persistent |
|------------|-------------|------|------------|
| `users` | Login accounts, roles | User creation/update | ✅ Forever |
| `salespeople` | Profiles, metrics | Profile creation | ✅ Forever |
| `sales` | **Full transcripts**, analysis, reports | After each call | ✅ Forever |
| `live_sales` | Active call status | During calls only | ⏱️ Temporary |

**Everything is saved to PocketBase. Nothing is lost.** 🎉
