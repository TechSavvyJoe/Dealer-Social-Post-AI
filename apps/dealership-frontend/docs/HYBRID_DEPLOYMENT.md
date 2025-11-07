# Hybrid Deployment: Vercel Frontend + Intel Mac Backend

Simple setup to run your frontend on Vercel (free CDN) and backend on your Intel Mac (free, unlimited).

---

## Part 1: Set Up Backend on Your Intel Mac (20 minutes)

### Step 1: Download PocketBase

```bash
# On your Intel Mac, open Terminal
mkdir ~/dealership-backend
cd ~/dealership-backend

# Download PocketBase for Intel Mac
curl -L https://github.com/pocketbase/pocketbase/releases/download/v0.22.0/pocketbase_0.22.0_darwin_amd64.zip -o pb.zip
unzip pb.zip
chmod +x pocketbase

# Start PocketBase
./pocketbase serve --http="0.0.0.0:8090"
```

**Output:** You'll see `Server started at http://0.0.0.0:8090`

### Step 2: Create Admin Account & Collections

1. Open browser on the Intel Mac: `http://localhost:8090/_/`
2. Create admin account (email + password)
3. Click **"New Collection"** and create these 4 collections:

**Collection 1: users** (Auth collection)
- Click "New Collection" → Type: **Auth**
- Name: `users`
- Add field: `role` → Type: Select → Options: `manager,salesman`

**Collection 2: salespeople** (Base collection)
- Click "New Collection" → Type: **Base**
- Name: `salespeople`
- Add fields:
  - `user_id` → Type: Relation → Collection: users
  - `name` → Type: Text
  - `performance_metrics` → Type: JSON

**Collection 3: sales** (Base collection)
- Name: `sales`
- Add fields:
  - `salesperson_id` → Type: Relation → Collection: salespeople
  - `customer_name` → Type: Text
  - `transcript` → Type: JSON
  - `analysis` → Type: JSON
  - `performance_report` → Type: JSON
  - `success_probability` → Type: Number

**Collection 4: live_sales** (Base collection)
- Name: `live_sales`
- Add fields:
  - `salesperson_id` → Type: Relation → Collection: salespeople
  - `customer_name` → Type: Text
  - `status` → Type: Select → Options: `active,ended`
  - `started_at` → Type: Date
  - `ended_at` → Type: Date (optional)

### Step 3: Set Permissions (Important!)

For each collection, click the collection → **API Rules** tab:

**users:**
- List/View rule: `@request.auth.id != "" && (@request.auth.role = "manager" || @request.auth.id = id)`
- Create rule: (leave empty - only admins create users initially)
- Update/Delete rule: `@request.auth.id = id`

**salespeople:**
- List/View: `@request.auth.id != "" && (@request.auth.role = "manager" || user_id = @request.auth.id)`
- Create/Update/Delete: `@request.auth.role = "manager"`

**sales:**
- List/View: `@request.auth.id != "" && (@request.auth.role = "manager" || salesperson_id.user_id = @request.auth.id)`
- Create: `@request.auth.id != ""`
- Update/Delete: `@request.auth.role = "manager"`

**live_sales:**
- Same as sales (copy/paste the rules)

Click **Save** for each.

### Step 4: Keep PocketBase Running (Choose One)

**Option A: Simple screen session** (temporary, good for testing)
```bash
screen -S pocketbase
cd ~/dealership-backend
./pocketbase serve --http="0.0.0.0:8090"
# Press Ctrl+A then D to detach
# Reattach later: screen -r pocketbase
```

**Option B: Auto-start on boot** (recommended for permanent setup)
```bash
# Create launch agent
cat > ~/Library/LaunchAgents/com.pocketbase.server.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pocketbase.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>/Users/YOUR_USERNAME/dealership-backend/pocketbase</string>
        <string>serve</string>
        <string>--http=0.0.0.0:8090</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>WorkingDirectory</key>
    <string>/Users/YOUR_USERNAME/dealership-backend</string>
    <key>StandardOutPath</key>
    <string>/Users/YOUR_USERNAME/dealership-backend/pocketbase.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/YOUR_USERNAME/dealership-backend/pocketbase.error.log</string>
</dict>
</plist>
EOF

# Replace YOUR_USERNAME with your actual macOS username (run: whoami)
# Example: /Users/joe/dealership-backend/pocketbase

# Load it
launchctl load ~/Library/LaunchAgents/com.pocketbase.server.plist

# Check it's running
launchctl list | grep pocketbase
```

### Step 5: Make It Accessible from Internet (Cloudflare Tunnel - FREE)

```bash
# Install Cloudflare Tunnel on Intel Mac
brew install cloudflare/cloudflare/cloudflared

# Login to Cloudflare
cloudflared tunnel login
# Opens browser - log in to your Cloudflare account (free account works)

# Create tunnel
cloudflared tunnel create dealership-backend

# Note the tunnel ID shown in output (looks like: abc123-def456-ghi789)

# Create config file
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << 'EOF'
tunnel: YOUR_TUNNEL_ID
credentials-file: /Users/YOUR_USERNAME/.cloudflared/YOUR_TUNNEL_ID.json

ingress:
  - hostname: api.yourdomain.com
    service: http://localhost:8090
  - service: http_status:404
EOF

# Replace:
# - YOUR_TUNNEL_ID with the ID from previous step
# - YOUR_USERNAME with your macOS username
# - api.yourdomain.com with your desired subdomain

# Create DNS record (do this ONCE)
cloudflared tunnel route dns dealership-backend api.yourdomain.com

# Run tunnel (test first)
cloudflared tunnel run dealership-backend
# You should see: "Connection established" and "Registered tunnel connection"
# Press Ctrl+C to stop

# Make tunnel auto-start on boot
sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
```

**Your backend is now live at:** `https://api.yourdomain.com`

---

## Part 2: Update Frontend Project (15 minutes)

### Step 1: Install PocketBase SDK

```bash
cd /Users/missionford/Downloads/dealership-ai-sales-coach
npm install pocketbase
```

### Step 2: Create PocketBase Client

```bash
# Create services directory if it doesn't exist
mkdir -p src/services

# Create PocketBase client
cat > src/services/pocketbaseClient.ts << 'EOF'
import PocketBase from 'pocketbase';

export const pb = new PocketBase(import.meta.env.VITE_POCKETBASE_URL);
pb.autoCancellation(false);

export default pb;
EOF
```

### Step 3: Create Auth Service

```bash
cat > src/services/authService.ts << 'EOF'
import { pb } from './pocketbaseClient';

export async function signIn(email: string, password: string) {
  const auth = await pb.collection('users').authWithPassword(email, password);
  return {
    user: auth.record,
    role: auth.record.role as 'manager' | 'salesman',
  };
}

export async function signUp(
  email: string,
  password: string,
  passwordConfirm: string,
  role: 'manager' | 'salesman'
) {
  const user = await pb.collection('users').create({
    email,
    password,
    passwordConfirm,
    role,
    emailVisibility: true,
  });
  return user;
}

export async function signOut() {
  pb.authStore.clear();
}

export function getCurrentUser() {
  return pb.authStore.model;
}

export function isAuthenticated() {
  return pb.authStore.isValid;
}

export function getUserRole(): 'manager' | 'salesman' | null {
  const user = pb.authStore.model;
  return user ? (user.role as 'manager' | 'salesman') : null;
}
EOF
```

### Step 4: Create Data Service

```bash
cat > src/services/dataService.ts << 'EOF'
import { pb } from './pocketbaseClient';

// Live Sales
export async function getLiveSales() {
  return pb.collection('live_sales').getFullList({
    filter: 'status = "active"',
    expand: 'salesperson_id',
    sort: '-started_at',
  });
}

export async function subscribeLiveSales(callback: (sales: any[]) => void) {
  await pb.collection('live_sales').subscribe('*', async () => {
    const sales = await getLiveSales();
    callback(sales);
  });
  
  // Also get initial data
  const initialSales = await getLiveSales();
  callback(initialSales);
}

export async function unsubscribeLiveSales() {
  pb.collection('live_sales').unsubscribe();
}

export async function startLiveSale(salespersonId: string, customerName: string) {
  return pb.collection('live_sales').create({
    salesperson_id: salespersonId,
    customer_name: customerName,
    status: 'active',
    started_at: new Date().toISOString(),
  });
}

export async function endLiveSale(id: string) {
  return pb.collection('live_sales').update(id, {
    status: 'ended',
    ended_at: new Date().toISOString(),
  });
}

// Sales
export async function getRecentSales(limit = 100) {
  return pb.collection('sales').getList(1, limit, {
    sort: '-created',
    expand: 'salesperson_id',
  });
}

export async function createSale(data: {
  salesperson_id: string;
  customer_name: string;
  transcript?: any;
  analysis?: any;
  performance_report?: any;
  success_probability?: number;
}) {
  return pb.collection('sales').create(data);
}

export async function getSaleById(id: string) {
  return pb.collection('sales').getOne(id, {
    expand: 'salesperson_id',
  });
}

// Salespeople
export async function getSalespeople() {
  return pb.collection('salespeople').getFullList({
    expand: 'user_id',
  });
}

export async function createSalesperson(data: {
  user_id: string;
  name: string;
  performance_metrics?: any;
}) {
  return pb.collection('salespeople').create(data);
}
EOF
```

### Step 5: Update Environment Variables

```bash
# Update .env.example
cat >> .env.example << 'EOF'

# PocketBase Backend (your Intel Mac via Cloudflare Tunnel)
VITE_POCKETBASE_URL=https://api.yourdomain.com
EOF

# Create .env.local for development
cat > .env.local << 'EOF'
# For local testing, use Tailscale or local IP
VITE_POCKETBASE_URL=http://localhost:8090

# Or use Cloudflare tunnel URL
# VITE_POCKETBASE_URL=https://api.yourdomain.com

VITE_GEMINI_API_KEY=your-gemini-api-key
EOF
```

### Step 6: Test Locally

```bash
npm run dev
# Open http://localhost:5173
# Try signing up a test user
```

---

## Part 3: Deploy Frontend to Vercel (5 minutes)

### Step 1: Add Environment Variable to Vercel

```bash
# Set PocketBase URL in Vercel
vercel env add VITE_POCKETBASE_URL
# When prompted, paste: https://api.yourdomain.com
# Select: Production, Preview, Development (all three)

# Add Gemini key too
vercel env add VITE_GEMINI_API_KEY
# Paste your Gemini API key
# Select: Production, Preview, Development
```

### Step 2: Deploy

```bash
git add .
git commit -m "feat: hybrid deployment - Vercel frontend + PocketBase backend"
git push
```

GitHub Actions will build and deploy to Vercel automatically.

---

## Part 4: Create Initial Users (5 minutes)

### Option 1: Via PocketBase Admin UI
1. Go to `http://localhost:8090/_/` (or `https://api.yourdomain.com/_/`)
2. Click **users** collection
3. Click **New record**
4. Fill in:
   - Email: `manager@dealership.com`
   - Password: `SecurePass123!`
   - Role: `manager`
5. Click **Create**
6. Repeat for salesman users

### Option 2: Via Your App's Sign Up
Once deployed, use your app's sign-up form (if you have one).

---

## Architecture Overview

```
┌─────────────┐
│   Users     │
└──────┬──────┘
       │
       ▼
┌─────────────────────┐
│  Vercel (Frontend)  │ ← Free hosting, global CDN
│  - React app        │
│  - Static files     │
└──────┬──────────────┘
       │
       │ HTTPS
       ▼
┌─────────────────────┐
│ Cloudflare Tunnel   │ ← Free secure tunnel
│  api.yourdomain.com │
└──────┬──────────────┘
       │
       │ Local network
       ▼
┌─────────────────────┐
│  Intel Mac (Home)   │ ← Your backend (free!)
│  - PocketBase:8090  │
│  - Auth + DB        │
│  - Realtime         │
│  - File storage     │
└─────────────────────┘
```

**Benefits:**
- ✅ Frontend: Fast global CDN (Vercel)
- ✅ Backend: Unlimited, free (your Mac)
- ✅ Secure: HTTPS via Cloudflare
- ✅ No monthly costs
- ✅ Full control of data

---

## Maintenance & Monitoring

### Check Backend Status
```bash
# On your Intel Mac:
# Check if PocketBase is running
launchctl list | grep pocketbase

# Check Cloudflare tunnel
sudo launchctl list | grep cloudflare

# View PocketBase logs
tail -f ~/dealership-backend/pocketbase.log

# View Cloudflare logs
tail -f /Library/Logs/com.cloudflare.cloudflared.err.log
```

### Backup Your Data
```bash
# PocketBase stores everything in pb_data folder
# Set up daily backups:
crontab -e

# Add this line (backs up daily at 2 AM):
0 2 * * * tar -czf ~/Backups/pocketbase-$(date +\%Y\%m\%d).tar.gz ~/dealership-backend/pb_data

# Create backup directory
mkdir -p ~/Backups
```

### Monitor Uptime
Free options:
- UptimeRobot (https://uptimerobot.com) - monitor `https://api.yourdomain.com/_/health`
- Uptime Kuma (self-hosted on same Mac)

---

## Troubleshooting

### Can't access backend from internet
```bash
# Check Cloudflare tunnel is running
sudo launchctl list | grep cloudflare

# If not running, start it:
sudo launchctl start com.cloudflare.cloudflared

# Check tunnel status
cloudflared tunnel info dealership-backend
```

### Frontend can't connect to backend
1. Check environment variable in Vercel: Project → Settings → Environment Variables
2. Ensure `VITE_POCKETBASE_URL` is set to `https://api.yourdomain.com`
3. Redeploy: `vercel --prod`

### PocketBase not starting
```bash
# Check if port 8090 is in use
lsof -i :8090

# Kill process if needed
kill -9 PID

# Restart PocketBase
launchctl stop com.pocketbase.server
launchctl start com.pocketbase.server
```

### Mac goes to sleep and stops backend
```bash
# Prevent sleep when plugged in:
sudo pmset -c sleep 0
sudo pmset -c disksleep 0

# Or use System Settings → Energy → Prevent sleeping when display is off
```

---

## Costs Breakdown

| Service | Monthly Cost |
|---------|--------------|
| Vercel (Frontend) | $0 (free tier) |
| Cloudflare Tunnel | $0 (free) |
| PocketBase | $0 (open source) |
| Domain name | ~$12/year ($1/month) |
| Electricity (Mac Mini 24/7) | ~$5-10 |
| **Total** | **~$6-11/month** |

Compare to all-cloud: $50-200/month for similar setup.

---

## Next Steps

1. ✅ Add more salesperson users via Admin UI
2. ✅ Test live sales feature (start/end sale, see realtime updates)
3. ✅ Set up automatic backups (cron job above)
4. ✅ Add monitoring (UptimeRobot)
5. Optional: Add custom domain to Vercel (Settings → Domains)

---

**You're done!** Frontend on Vercel, backend on your Intel Mac, zero monthly fees (except electricity + domain).
