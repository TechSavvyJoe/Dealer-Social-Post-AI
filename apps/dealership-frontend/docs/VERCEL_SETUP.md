# Vercel Deployment Setup

This guide walks you through deploying the Dealership AI Sales Coach to Vercel, a serverless platform for frontend applications.

## Prerequisites

- ✅ Completed [Supabase Setup](./SUPABASE_SETUP.md)
- ✅ Completed [GitHub Setup](./GITHUB_SETUP.md)
- GitHub account with repository access
- Vercel account (free tier works fine)

---

## Step 1: Create Vercel Account

1. Go to [vercel.com](https://vercel.com)
2. Click **"Sign Up"** in the top right
3. **Sign up with GitHub** (recommended for automatic deployments)
4. Authorize Vercel to access your GitHub account
5. Complete the onboarding questions (optional)

---

## Step 2: Import GitHub Repository

### Option A: Through Vercel Dashboard (Recommended)

1. From your Vercel dashboard, click **"Add New..."** → **"Project"**
2. Under "Import Git Repository", find your repo:
   - If you don't see it, click **"Adjust GitHub App Permissions"**
   - Grant access to the `dealership-ai-sales-coach` repository
3. Click **"Import"** next to your repository

### Option B: Through Vercel CLI

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy from project directory
cd /Users/missionford/Downloads/dealership-ai-sales-coach
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? Select your account
# - Link to existing project? No
# - What's your project's name? dealership-ai-sales-coach
# - In which directory is your code located? ./
# - Want to override settings? No
```

---

## Step 3: Configure Build Settings

Vercel should auto-detect these settings from `vercel.json`, but verify:

1. **Framework Preset**: `Vite`
2. **Build Command**: `npm run build`
3. **Output Directory**: `dist`
4. **Install Command**: `npm install`
5. **Node.js Version**: `20.x`

If not detected, manually set these in **Project Settings** → **General** → **Build & Development Settings**.

---

## Step 4: Add Environment Variables

This is the most critical step for your app to work properly.

### In Vercel Dashboard:

1. Go to your project → **Settings** → **Environment Variables**
2. Add the following variables for **Production**, **Preview**, and **Development**:

| Variable Name | Value | Where to Get It |
|---------------|-------|-----------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL | Supabase Dashboard → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Your Supabase anon/public key | Supabase Dashboard → Settings → API → Project API keys → anon public |
| `VITE_GEMINI_API_KEY` | Your Google Gemini API key | [Google AI Studio](https://aistudio.google.com/app/apikey) |

### Using Vercel CLI:

```bash
# Install once globally (optional)
npm install -g vercel

# Pull current envs to .env.local (optional for local dev)
vercel env pull

# Add environment variables (repeat for Production/Preview/Development)
# When prompted, paste your value and select the environment
vercel env add VITE_SUPABASE_URL
vercel env add VITE_SUPABASE_ANON_KEY
vercel env add VITE_GEMINI_API_KEY
```

### Important Notes:

- ⚠️ **All variables must start with `VITE_`** for Vite to expose them to the client
- ✅ Select **all environments** (Production, Preview, Development) for each variable
- 🔒 **Never commit** actual API keys to GitHub (use `.env.example` as template only)
- 📝 Copy values exactly - no extra spaces or quotes

---

## Step 5: Deploy to Production

### Automatic Deployment (Recommended):

1. Push to your `main` branch on GitHub:
   ```bash
   git add .
   git commit -m "Configure Vercel deployment"
   git push origin main
   ```
2. Vercel will automatically deploy within 1-2 minutes
3. Watch progress in Vercel dashboard → **Deployments**

### Manual Deployment:

```bash
# Deploy to production
vercel --prod

# Your app will be live at:
# https://dealership-ai-sales-coach-your-username.vercel.app
```

---

## Step 6: Configure Custom Domain (Optional)

1. Go to **Project Settings** → **Domains**
2. Click **"Add"**
3. Enter your domain (e.g., `sales-coach.yourdealership.com`)
4. Follow DNS configuration instructions:
   - **A Record**: Point to Vercel's IP (`76.76.21.21`)
   - **CNAME**: Point to `cname.vercel-dns.com`
5. Wait for DNS propagation (5-60 minutes)
6. Vercel will automatically provision SSL certificate

---

## Step 7: Enable Automatic Deployments

These should be enabled by default, but verify:

1. Go to **Project Settings** → **Git**
2. Ensure these are checked:
   - ✅ **Production Branch**: `main`
   - ✅ **Deploy Hooks**: Enabled
   - ✅ **Auto-deploy only Production Branch**: Checked
   - ✅ **Comments**: Enabled (adds deployment links to PRs)
3. **Preview Deployments**: Ensure enabled for all branches

Now:
- Pushing to `main` → Production deployment
- Creating a PR → Preview deployment with unique URL
- Pushing to other branches → Preview deployment

---

## Step 8: Configure Deployment Protection (Optional)

For production apps handling sensitive data:

1. Go to **Project Settings** → **Deployment Protection**
2. Enable **Vercel Authentication** to require login before accessing deployments
3. Or enable **Password Protection** for preview deployments
4. Configure **Trusted IPs** to whitelist your office/dealership IP

---

## Step 9: Monitor Deployments

### Check Deployment Status:

1. Go to **Deployments** tab in Vercel dashboard
2. Click on latest deployment
3. Review:
   - ✅ Build logs (should show no errors)
   - ✅ Runtime logs (after deployment)
   - ✅ Environment variables (verify they're set)

### View Live Application:

1. Click **"Visit"** on successful deployment
2. You should see the login screen
3. Test login with credentials from your Supabase database

### Troubleshooting Deployment Issues:

```bash
# View production logs
vercel logs

# View specific deployment logs
vercel logs [deployment-url]

# Redeploy production
vercel --prod
```

---

## Step 10: Testing Your Production Deployment

### 1. Test Login:

- Visit your production URL
- Login as manager (`manager@dealership.com` / `password123` from sample data)
- Verify Manager Dashboard loads

### 2. Test Salesman View:

- Login as salesman (`alice@dealership.com` / `password123`)
- Verify Salesman Dashboard loads
- Check if you can start a live sale

### 3. Test Real-time Features:

- Open two browser windows (manager and salesman)
- Start a live sale as salesman
- Verify manager sees it in real-time on their dashboard

### 4. Test Analytics:

- As manager, navigate to Analytics tab
- Verify charts load with sample data
- Check performance reports

---

## Production Checklist

Before going live with real users:

- [ ] All environment variables set correctly
- [ ] Supabase database schema deployed
- [ ] Supabase RLS policies enabled
- [ ] Custom domain configured (if using)
- [ ] SSL certificate active (automatic with Vercel)
- [ ] Test login with manager and salesman accounts
- [ ] Test real-time sale monitoring
- [ ] Test audio recording (if implemented)
- [ ] Review Vercel usage limits (free tier has limits)
- [ ] Set up deployment notifications (Settings → Notifications)
- [ ] Configure error tracking (consider Sentry integration)
- [ ] Remove sample data from Supabase (delete test users/sales)

---

## Vercel Free Tier Limits

Be aware of these limits on the free Hobby plan:

- **Bandwidth**: 100GB/month
- **Build Execution**: 6000 minutes/month
- **Serverless Function Execution**: 100GB-hours/month
- **Deployments**: Unlimited
- **Team Size**: 1 user

For production use with multiple team members, consider upgrading to Pro ($20/month).

---

## Useful Vercel Commands

```bash
# View deployment list
vercel ls

# View environment variables
vercel env ls

# Pull environment variables to local .env file
vercel env pull

# View project details
vercel inspect

# Remove a deployment
vercel remove [deployment-id]

# Link local project to Vercel project
vercel link
```

---

## Integrations

### Enable Vercel Integrations (Optional):

1. **Sentry** (Error Tracking):
   - Go to **Integrations** → Search "Sentry"
   - Connect your Sentry account
   - Automatic error reporting

2. **LogDrain** (Advanced Logging):
   - Go to **Integrations** → Search "LogDrain"
   - Send logs to external service

3. **Checkly** (Monitoring):
   - Go to **Integrations** → Search "Checkly"
   - Set up uptime monitoring

---

## Troubleshooting

### Build Fails:

**Error**: `Command "npm run build" exited with 1`

**Solutions**:
```bash
# Test build locally first
npm run build

# Check build logs in Vercel dashboard
# Common issues:
# - TypeScript errors
# - Missing dependencies
# - Environment variable issues
```

### Environment Variables Not Working:

**Symptoms**: App loads but can't connect to Supabase

**Solutions**:
1. Verify variables are set for correct environment (Production/Preview/Development)
2. Ensure variable names start with `VITE_`
3. Redeploy after adding variables (they don't apply to existing deployments)
4. Check for typos in variable names

### App Loads But Shows Errors:

**Check browser console** (F12):
```
# Supabase connection error
→ Verify VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# Gemini API error
→ Verify VITE_GEMINI_API_KEY and quota limits

# CORS errors
→ Add your Vercel domain to Supabase allowed URLs
   (Supabase Dashboard → Authentication → URL Configuration)
```

### Real-time Features Not Working:

1. Go to Supabase Dashboard → Database → Replication
2. Ensure `live_sales` table has replication enabled
3. Check browser console for WebSocket connection errors

### Deployment Takes Too Long:

- Check **Build & Development Settings** → Ensure build command is correct
- Review build logs for hanging processes
- Consider upgrading Node.js version in `vercel.json`

---

## Security Best Practices

1. ✅ **Never commit `.env` to Git** (it's in `.gitignore`)
2. ✅ **Rotate API keys** if accidentally exposed
3. ✅ **Use Supabase RLS policies** for data protection
4. ✅ **Enable Vercel Deployment Protection** for sensitive apps
5. ✅ **Configure CORS properly** in Supabase
6. ✅ **Review Vercel logs regularly** for suspicious activity
7. ✅ **Set up alerting** for deployment failures

---

## Next Steps

- ✅ Review [Master Deployment Guide](./DEPLOYMENT_GUIDE.md) for end-to-end setup
- 📊 Set up analytics tracking (Vercel Analytics)
- 🔔 Configure Slack/email notifications for deployments
- 🧪 Set up staging environment (use preview deployments)
- 📱 Test on mobile devices
- 🎯 Monitor performance in Vercel Speed Insights

---

## Support Resources

- **Vercel Documentation**: [vercel.com/docs](https://vercel.com/docs)
- **Vercel Support**: [vercel.com/support](https://vercel.com/support)
- **Community Forums**: [github.com/vercel/vercel/discussions](https://github.com/vercel/vercel/discussions)
- **Status Page**: [vercel-status.com](https://www.vercel-status.com)

---

**Deployment Complete!** 🎉

Your Dealership AI Sales Coach is now live and accessible worldwide.
