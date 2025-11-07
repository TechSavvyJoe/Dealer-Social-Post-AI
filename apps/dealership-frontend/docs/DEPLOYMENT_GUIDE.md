# Complete Deployment Guide

**Deploy your Dealership AI Sales Coach to production in under 30 minutes.**

This master guide walks you through the complete deployment process across all three platforms: Supabase (database), GitHub (version control), and Vercel (hosting).

---

## 📋 Overview

This deployment consists of three main components:

1. **Supabase**: PostgreSQL database with real-time capabilities
2. **GitHub**: Version control and CI/CD workflows
3. **Vercel**: Serverless hosting platform

**Estimated Time**: 20-30 minutes (first time)

---

## 🎯 Prerequisites

Before you begin, ensure you have:

- [ ] Code for Dealership AI Sales Coach (this repository)
- [ ] GitHub account ([sign up](https://github.com/join))
- [ ] Supabase account ([sign up](https://supabase.com))
- [ ] Vercel account ([sign up](https://vercel.com))
- [ ] Google Gemini API key ([get one](https://aistudio.google.com/app/apikey))
- [ ] Basic terminal/command line familiarity
- [ ] Git installed on your computer

---

## 🚀 Quick Start (Step-by-Step)

### Phase 1: Database Setup (Supabase)

**Time**: ~5-10 minutes

1. **Create Supabase project**:
   - Go to [app.supabase.com](https://app.supabase.com)
   - Click "New Project"
   - Choose organization (or create one)
   - Project name: `dealership-ai-sales-coach`
   - Database password: **Save this securely!**
   - Region: Choose closest to your location
   - Click "Create new project" (wait 2-3 minutes)

2. **Deploy database schema**:
   - In Supabase dashboard, go to **SQL Editor**
   - Click "New Query"
   - Copy entire contents of `supabase/schema.sql`
   - Paste into SQL editor
   - Click "Run" (bottom right)
   - Verify success: "Success. No rows returned"

3. **Get API credentials**:
   - Go to **Settings** (gear icon) → **API**
   - Copy **Project URL** → Save as `VITE_SUPABASE_URL`
   - Copy **anon public key** → Save as `VITE_SUPABASE_ANON_KEY`
   - Keep these for Step 3 (Vercel deployment)

4. **Enable Realtime**:
   - Go to **Database** → **Replication**
   - Find `live_sales` table
   - Toggle **Realtime** to ON
   - Click "Save"

**✅ Supabase is ready!** Your database is live with sample data.

**Detailed guide**: [docs/SUPABASE_SETUP.md](./SUPABASE_SETUP.md)

---

### Phase 2: Version Control (GitHub)

**Time**: ~5 minutes

1. **Create GitHub repository**:
   
   **Option A - Web Interface** (easier):
   - Go to [github.com/new](https://github.com/new)
   - Repository name: `dealership-ai-sales-coach`
   - Description: "AI-powered sales coaching system for automotive dealerships"
   - Visibility: Private (recommended) or Public
   - **Do NOT initialize** with README, .gitignore, or license
   - Click "Create repository"

   **Option B - Command Line**:
   ```bash
   # Install GitHub CLI (if not installed)
   brew install gh  # macOS
   
   # Login to GitHub
   gh auth login
   
   # Create repository
   gh repo create dealership-ai-sales-coach --private --source=. --remote=origin
   ```

2. **Push your code to GitHub**:
   ```bash
   # Navigate to project directory
   cd /Users/missionford/Downloads/dealership-ai-sales-coach
   
   # Initialize git (if not already done)
   git init
   
   # Add all files
   git add .
   
   # Commit
   git commit -m "Initial commit: Dealership AI Sales Coach"
   
   # Add remote (replace YOUR-USERNAME)
   git remote add origin https://github.com/YOUR-USERNAME/dealership-ai-sales-coach.git
   
   # Push to GitHub
   git branch -M main
   git push -u origin main
   ```

3. **Set up GitHub Secrets** (for CI/CD):
   - Go to your repository on GitHub
   - Click **Settings** → **Secrets and variables** → **Actions**
   - Click **New repository secret**
   - Add these secrets:

   | Name | Value | Where to Get |
   |------|-------|--------------|
   | `VITE_SUPABASE_URL` | Your Supabase URL | From Phase 1, Step 3 |
   | `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key | From Phase 1, Step 3 |
   | `VITE_GEMINI_API_KEY` | Your Gemini API key | [Google AI Studio](https://aistudio.google.com/app/apikey) |

**✅ GitHub is configured!** Your code is version-controlled.

**Detailed guide**: [docs/GITHUB_SETUP.md](./GITHUB_SETUP.md)

---

### Phase 3: Hosting (Vercel)

**Time**: ~5-10 minutes

1. **Create Vercel account & import project**:
   - Go to [vercel.com](https://vercel.com)
   - Click "Sign Up" → **Sign up with GitHub** (easiest)
   - Authorize Vercel
   - Click "Add New..." → "Project"
   - Import your `dealership-ai-sales-coach` repository
   - Click "Import"

2. **Configure build settings** (auto-detected from `vercel.json`):
   - Framework: Vite ✅
   - Build Command: `npm run build` ✅
   - Output Directory: `dist` ✅
   - Install Command: `npm install` ✅

3. **Add environment variables**:
   - Click **Environment Variables** section
   - Add these three variables (for Production, Preview, Development):

   | Variable | Value |
   |----------|-------|
   | `VITE_SUPABASE_URL` | Your Supabase URL (from Phase 1) |
   | `VITE_SUPABASE_ANON_KEY` | Your Supabase anon key (from Phase 1) |
   | `VITE_GEMINI_API_KEY` | Your Gemini API key |

   **Important**: Select **all three environments** for each variable!

4. **Deploy**:
   - Click **Deploy**
   - Wait 1-2 minutes for build to complete
   - Click **Visit** to see your live application!

**✅ Vercel deployment complete!** Your app is live.

**Detailed guide**: [docs/VERCEL_SETUP.md](./VERCEL_SETUP.md)

---

## 🧪 Testing Your Deployment

After deployment, test these critical features:

### 1. Manager Login
```
URL: https://your-app.vercel.app
Email: manager@dealership.com
Password: password123
```
- ✅ Should see Manager Dashboard
- ✅ Tabs: Dashboard, History, Analytics, Team, Settings
- ✅ No live sales yet (none active)

### 2. Salesman Login
```
Email: alice@dealership.com
Password: password123
```
- ✅ Should see Salesman Dashboard
- ✅ "Start New Sale" button visible
- ✅ Can click to start live sale

### 3. Real-Time Monitoring
- Open two browser windows (private/incognito)
- Window 1: Login as manager
- Window 2: Login as Alice (salesman)
- In Window 2: Click "Start New Sale"
- In Window 1: Should see Alice's live sale appear in real-time
- ✅ This confirms Supabase Realtime is working

### 4. Analytics
- As manager, navigate to **Analytics** tab
- ✅ Should see charts with sample data
- ✅ Performance metrics displayed
- ✅ Team performance donut chart

---

## 🔧 Post-Deployment Configuration

### Update Supabase Allowed URLs

To prevent CORS errors:

1. Go to Supabase Dashboard → **Authentication** → **URL Configuration**
2. Add your Vercel URL to **Site URL**: `https://your-app.vercel.app`
3. Add to **Redirect URLs**: `https://your-app.vercel.app/**`
4. Click **Save**

### Remove Sample Data (Production)

Before real users access the system:

```sql
-- Run in Supabase SQL Editor
DELETE FROM sales WHERE id IS NOT NULL;
DELETE FROM salespeople WHERE id IS NOT NULL;
DELETE FROM users WHERE email LIKE '%@dealership.com';

-- Keep one manager account and change the password
UPDATE users SET password_hash = crypt('your-secure-password', gen_salt('bf'))
WHERE email = 'manager@dealership.com';
```

### Set Up Custom Domain (Optional)

1. In Vercel dashboard → **Settings** → **Domains**
2. Click "Add"
3. Enter: `sales-coach.yourdealership.com`
4. Configure DNS with your domain provider:
   - Add CNAME: `sales-coach` → `cname.vercel-dns.com`
5. Wait for SSL certificate (automatic, ~5 minutes)

---

## 📊 Monitoring & Maintenance

### Vercel Deployments

- **Automatic deploys**: Every push to `main` branch triggers production deployment
- **Preview deploys**: Every pull request gets a unique preview URL
- **View logs**: Vercel Dashboard → Deployments → [deployment] → Logs

### Supabase Monitoring

- **Database usage**: Supabase Dashboard → Home → Database usage
- **API requests**: Supabase Dashboard → Home → API requests
- **Storage**: Check auth.users table growth

### GitHub Actions

- **CI status**: GitHub repo → Actions tab
- **Failed builds**: Get notified via GitHub notifications
- **View logs**: Click on any workflow run

---

## 🚨 Troubleshooting

### App loads but shows login errors

**Symptom**: Can't login, "Invalid credentials" errors

**Solution**:
1. Check Supabase **API** settings → Verify URL and anon key
2. Ensure environment variables in Vercel match exactly
3. Redeploy in Vercel (Deployments → [...] → Redeploy)

### Real-time features not working

**Symptom**: Manager doesn't see live sales updates

**Solution**:
1. Supabase Dashboard → Database → Replication
2. Toggle `live_sales` table to ON
3. Check browser console (F12) for WebSocket errors
4. Verify Supabase URL in allowed origins

### Build fails on Vercel

**Symptom**: Deployment failed, build errors

**Solution**:
```bash
# Test build locally first
npm install
npm run build

# If it works locally, check:
# 1. Node version (should be 20.x)
# 2. Environment variables are set
# 3. Build logs in Vercel dashboard
```

### Gemini API errors

**Symptom**: AI coaching features don't work

**Solution**:
1. Verify `VITE_GEMINI_API_KEY` is set correctly
2. Check [Google AI Studio](https://aistudio.google.com/app/apikey) for API quota
3. Ensure API key has proper permissions
4. Check browser console for specific error messages

---

## 🔐 Security Checklist

Before going live with real data:

- [ ] Change all sample user passwords in Supabase
- [ ] Delete sample data (sales, salespeople)
- [ ] Enable Supabase RLS policies (already done by schema)
- [ ] Verify environment variables are in Vercel (not hardcoded)
- [ ] Add your domain to Supabase allowed URLs
- [ ] Enable branch protection on GitHub (Settings → Branches)
- [ ] Set up Vercel deployment protection (Settings → Deployment Protection)
- [ ] Review Vercel security headers (configured in `vercel.json`)
- [ ] Enable 2FA on GitHub, Supabase, and Vercel accounts
- [ ] Regular API key rotation schedule

---

## 📈 Scaling Considerations

### Free Tier Limits

**Supabase Free Tier**:
- 500MB database
- 1GB file storage
- 2GB bandwidth/month
- Upgrade: $25/month for Pro

**Vercel Free Tier**:
- 100GB bandwidth/month
- 6000 build minutes/month
- Upgrade: $20/month for Pro

**Gemini API Free Tier**:
- 60 requests/minute
- Check current limits: [Google AI Studio](https://aistudio.google.com)

### When to Upgrade

Upgrade when you hit:
- **10+ active salespeople**: Consider Supabase Pro
- **50+ sales/day**: Monitor database size
- **High traffic**: Watch Vercel bandwidth
- **Team collaboration**: Vercel Pro for multiple users

---

## 🔄 Continuous Deployment Workflow

Your app is now set up for continuous deployment:

1. **Make changes locally**:
   ```bash
   # Edit files in your code editor
   npm run dev  # Test locally
   ```

2. **Commit and push**:
   ```bash
   git add .
   git commit -m "Add new feature"
   git push origin main
   ```

3. **Automatic deployment**:
   - GitHub receives push
   - Vercel automatically deploys
   - Live in ~2 minutes

4. **For larger changes, use branches**:
   ```bash
   git checkout -b feature/new-analytics
   # Make changes
   git push origin feature/new-analytics
   # Create Pull Request on GitHub
   # Vercel creates preview deployment
   # Review → Merge → Auto-deploy to production
   ```

---

## 📚 Additional Resources

### Documentation
- [Supabase Setup Guide](./SUPABASE_SETUP.md) - Detailed database configuration
- [GitHub Setup Guide](./GITHUB_SETUP.md) - Version control & CI/CD
- [Vercel Setup Guide](./VERCEL_SETUP.md) - Hosting & deployment

### External Docs
- [Supabase Documentation](https://supabase.com/docs)
- [Vercel Documentation](https://vercel.com/docs)
- [GitHub Actions Docs](https://docs.github.com/en/actions)
- [Vite Documentation](https://vitejs.dev)

### Support
- **Supabase**: [Discord Community](https://discord.supabase.com)
- **Vercel**: [Community Forums](https://github.com/vercel/vercel/discussions)
- **GitHub**: [Support](https://support.github.com)

---

## 🎉 Deployment Complete!

Your Dealership AI Sales Coach is now:
- ✅ **Live** on a production URL
- ✅ **Secure** with RLS policies and environment variables
- ✅ **Real-time** with Supabase subscriptions
- ✅ **Scalable** on serverless infrastructure
- ✅ **Automated** with continuous deployment

**Next Steps**:
1. Share the URL with your team
2. Create real user accounts (delete sample data first)
3. Monitor usage in first week
4. Gather feedback and iterate
5. Consider custom domain for professional branding

---

**Need help?** Review the detailed guides in the `docs/` folder or open an issue on GitHub.

**Happy Selling!** 🚗💰
