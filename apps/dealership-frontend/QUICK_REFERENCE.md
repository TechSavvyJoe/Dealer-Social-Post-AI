# Quick Reference - Dealership AI Sales Coach

## 🌐 Your URLs

### Development (Local)
- **Frontend**: http://localhost:5173
- **Backend Admin**: http://localhost:8090/_/
- **Backend API**: http://localhost:8090/api/

### Production (Worldwide Access)
- **Frontend**: https://dealership-ai-sales-coach-p14sh8vl8-joes-projects-01f07834.vercel.app
- **Backend (via Cloudflare)**: https://slideshow-regulatory-greatly-subcommittee.trycloudflare.com
- **Backend Admin (from anywhere)**: https://slideshow-regulatory-greatly-subcommittee.trycloudflare.com/_/

---

## 🔐 Create Users

### Via PocketBase Admin UI
1. Go to http://localhost:8090/_/ on your Intel Mac
2. Click **users** collection
3. Click **New record**
4. Fill in:
   - **Email**: user@example.com
   - **Password**: YourSecurePassword123!
   - **Role**: Select `manager` or `salesman`
5. Click **Create**

### User Roles
- **Manager**: Can view all sales, all salespeople, analytics dashboard
- **Salesman**: Can only view their own sales and performance

---

## 🛠️ Common Tasks

### Start Dev Server (This Computer)
```bash
cd ~/Downloads/dealership-ai-sales-coach
npm run dev
```

### Deploy to Production
```bash
git add .
git commit -m "your message"
git push
# Vercel auto-deploys in ~60 seconds
```

### Check Vercel Deployments
```bash
vercel ls
```

### Manual Deploy to Vercel
```bash
vercel deploy --prod
```

---

## 🖥️ Intel Mac Backend (24/7 Server)

### Check if PocketBase is Running
```bash
# On Intel Mac
launchctl list | grep pocketbase
```

### View PocketBase Logs
```bash
tail -f ~/dealership-backend/pocketbase.log
```

### Restart PocketBase
```bash
launchctl stop com.pocketbase.server
launchctl start com.pocketbase.server
```

### Check Cloudflare Tunnel Status
```bash
sudo launchctl list | grep cloudflare
```

### Restart Cloudflare Tunnel
```bash
sudo launchctl stop com.cloudflare.cloudflared
sudo launchctl start com.cloudflare.cloudflared
```

---

## 💾 Backups

### Manual Backup
```bash
# On Intel Mac
tar -czf ~/Backups/pocketbase-backup-$(date +%Y%m%d-%H%M%S).tar.gz ~/dealership-backend/pb_data
```

### Restore from Backup
```bash
# Stop PocketBase first
launchctl stop com.pocketbase.server

# Restore
tar -xzf ~/Backups/pocketbase-backup-YYYYMMDD-HHMMSS.tar.gz -C ~/dealership-backend/

# Start PocketBase
launchctl start com.pocketbase.server
```

### View Automatic Backups
```bash
ls -lh ~/Backups/
```

---

## 🐛 Troubleshooting

### Frontend won't connect to backend
1. Check `.env.local` has: `VITE_POCKETBASE_URL=https://slideshow-regulatory-greatly-subcommittee.trycloudflare.com`
2. Check Vercel env vars: `vercel env ls`
3. Restart dev server: Stop and run `npm run dev`

### PocketBase not accessible from internet
```bash
# Check tunnel is running
sudo launchctl list | grep cloudflare

# If not running, start it
sudo launchctl start com.cloudflare.cloudflared

# Check tunnel info
cloudflared tunnel info dealership-backend
```

### Vercel deployment failed
```bash
# Check recent runs
gh run list --limit 3

# View specific run
gh run view XXXXXXX

# Try manual deploy
vercel deploy --prod
```

### Port 8090 already in use
```bash
# Find process using port
lsof -i :8090

# Kill it (replace PID with actual number)
kill -9 PID

# Restart PocketBase
launchctl start com.pocketbase.server
```

---

## 📊 Database Collections

### users (Auth)
- email (string)
- password (hashed)
- role (select: manager/salesman)

### salespeople
- user_id (relation → users)
- name (string)
- performance_metrics (JSON)

### sales
- salesperson_id (relation → salespeople)
- customer_name (string)
- transcript (JSON)
- analysis (JSON)
- performance_report (JSON)
- success_probability (number)

### live_sales
- salesperson_id (relation → salespeople)
- customer_name (string)
- status (select: active/ended)
- started_at (date)
- ended_at (date, optional)

---

## 💰 Monthly Costs

| Service | Cost |
|---------|------|
| Vercel | $0 (free tier) |
| Cloudflare Tunnel | $0 |
| PocketBase | $0 (open source) |
| Domain (optional) | ~$12/year |
| Electricity (Mac 24/7) | ~$5-10/month |
| **Total** | **~$5-10/month** |

---

## 🔗 Important Links

- **Vercel Dashboard**: https://vercel.com/joes-projects-01f07834/dealership-ai-sales-coach
- **GitHub Repo**: https://github.com/TechSavvyJoe/dealership-ai-sales-coach
- **PocketBase Docs**: https://pocketbase.io/docs/
- **Cloudflare Dashboard**: https://dash.cloudflare.com/

---

## 📝 Architecture

```
┌──────────────────┐
│   Global Users   │
└────────┬─────────┘
         │
         ▼
┌────────────────────────┐
│  Vercel CDN (Frontend) │ ← React app, static files
│  - 200+ edge locations │
│  - Auto HTTPS           │
│  - Auto deploys         │
└────────┬───────────────┘
         │
         │ HTTPS requests
         ▼
┌────────────────────────┐
│  Cloudflare Tunnel     │ ← Free secure tunnel
│  - Auto SSL             │
│  - DDoS protection      │
│  - No port forwarding   │
└────────┬───────────────┘
         │
         │ Local network
         ▼
┌────────────────────────┐
│  Intel Mac @ Home      │ ← Your backend
│  - PocketBase :8090     │
│  - Auth + Database      │
│  - Realtime subs        │
│  - File storage         │
│  - Backups              │
└────────────────────────┘
```

---

## 🎯 Next Steps

1. ✅ Create your first manager user via PocketBase admin
2. ✅ Log in to production app and test
3. ✅ Create salesperson users for your team
4. ✅ Set up monitoring (optional): https://uptimerobot.com
5. ✅ Add custom domain to Vercel (optional)
6. ✅ Connect real Gemini API key for AI features

---

**Need help?** Check `docs/HYBRID_DEPLOYMENT.md` for detailed setup instructions.
