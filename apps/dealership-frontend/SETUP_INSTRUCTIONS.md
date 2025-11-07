# Quick Setup Instructions

Since you already have GitHub and Vercel accounts connected, here's what you need to do:

## 🚀 Automated Setup Complete ✅

I've already done:
- ✅ Initialized Git repository
- ✅ Created initial commit with all files
- ✅ Set up GitHub Actions workflows (CI + Vercel deployment)
- ✅ Updated .gitignore to protect sensitive files
- ✅ Created environment variable template

---

## 📝 Manual Steps Required

### 1. Create GitHub Repository

Since you're already connected to GitHub, run:

```bash
# Install GitHub CLI if not already installed
brew install gh

# Login to GitHub
gh auth login

# Create repository and push
gh repo create dealership-ai-sales-coach --private --source=. --remote=origin --push
```

**Or create via web interface:**
1. Go to https://github.com/new
2. Repository name: `dealership-ai-sales-coach`
3. Private/Public: Choose based on preference
4. **DO NOT** initialize with README
5. Click "Create repository"
6. Then run:
   ```bash
   git remote add origin https://github.com/YOUR-USERNAME/dealership-ai-sales-coach.git
   git push -u origin main
   ```

---

### 2. Add GitHub Secrets

Go to your repository → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**

Add these **7 secrets**:

| Secret Name | Where to Get It |
|-------------|-----------------|
| `VITE_SUPABASE_URL` | Supabase Dashboard → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase Dashboard → Settings → API → anon public key |
| `VITE_GEMINI_API_KEY` | https://aistudio.google.com/app/apikey |
| `VERCEL_TOKEN` | Vercel Dashboard → Settings → Tokens → Create Token |
| `VERCEL_ORG_ID` | See instructions below |
| `VERCEL_PROJECT_ID` | See instructions below |

#### Get VERCEL_ORG_ID and VERCEL_PROJECT_ID:

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Link to your existing Vercel project (or create new one)
vercel link

# This creates .vercel/project.json with your IDs
cat .vercel/project.json
```

Copy the `orgId` and `projectId` from that file to GitHub secrets.

**Alternative method:**
1. Go to Vercel Dashboard → Your Project → Settings → General
2. Scroll to "Project ID" - copy this as `VERCEL_PROJECT_ID`
3. For `VERCEL_ORG_ID`, go to Vercel Settings (top right) → General → "Team ID" or "User ID"

---

### 3. Set Up Vercel Project

If you haven't already created the Vercel project:

1. Go to https://vercel.com/new
2. Import your GitHub repository: `dealership-ai-sales-coach`
3. **Configure Project**:
   - Framework Preset: `Vite` (auto-detected)
   - Build Command: `npm run build`
   - Output Directory: `dist`
   - Install Command: `npm install`

4. **Add Environment Variables** (in Vercel):
   
   Click "Environment Variables" and add for **Production**, **Preview**, and **Development**:
   
   - `VITE_SUPABASE_URL` = Your Supabase URL
   - `VITE_SUPABASE_ANON_KEY` = Your Supabase anon key
   - `VITE_GEMINI_API_KEY` = Your Gemini API key

5. **Deploy** (or skip - GitHub Actions will handle it)

---

### 4. Set Up Supabase Database

1. Go to https://app.supabase.com
2. Click "New Project"
3. Name: `dealership-ai-sales-coach`
4. Database Password: **Choose a strong password and save it!**
5. Region: Choose closest to you
6. Wait 2-3 minutes for provisioning

7. **Deploy Schema**:
   - Go to SQL Editor
   - Click "New Query"
   - Copy contents of `supabase/schema.sql`
   - Paste and click "Run"

8. **Enable Realtime**:
   - Database → Replication
   - Toggle ON for `live_sales` table

9. **Get API Keys**:
   - Settings → API
   - Copy Project URL and anon public key
   - Add these to GitHub Secrets and Vercel Environment Variables

---

## 🎯 Testing Your Setup

Once GitHub Secrets and Vercel are configured:

1. **Push to GitHub** (already done):
   ```bash
   git status  # Should show "nothing to commit, working tree clean"
   ```

2. **Watch GitHub Actions**:
   - Go to your repository → Actions tab
   - You should see workflows running
   - "CI - Build and Test" checks your code
   - "Deploy to Vercel" deploys your app

3. **Check Vercel**:
   - Go to Vercel dashboard
   - Your project should show recent deployment
   - Click "Visit" to see live app

4. **Test Login**:
   - Visit your Vercel URL
   - Login with: `manager@dealership.com` / `password123`
   - Should see Manager Dashboard

---

## 🔄 How Auto-Deployment Works

Now that everything is set up:

1. **Make changes locally**:
   ```bash
   # Edit files
   git add .
   git commit -m "Your changes"
   git push origin main
   ```

2. **GitHub Actions automatically**:
   - Runs CI tests
   - Builds your app
   - Deploys to Vercel production

3. **For Pull Requests**:
   - Create a branch: `git checkout -b feature/new-thing`
   - Push: `git push origin feature/new-thing`
   - Create PR on GitHub
   - GitHub Actions deploys preview version
   - Comments on PR with preview URL

---

## 🆘 Troubleshooting

### GitHub Actions failing?

1. Check Secrets are set correctly (Settings → Secrets and variables → Actions)
2. Verify all 7 secrets are present
3. Check workflow runs for specific error messages

### Vercel deployment failing?

1. Ensure environment variables are set in Vercel dashboard
2. Check that `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` are correct
3. Verify you've run `vercel link` to connect your project

### Build errors?

```bash
# Test locally first
npm install
npm run build

# If it works locally but fails in CI:
# - Check GitHub Secrets environment variables
# - Ensure Node version matches (20.x)
```

---

## 📊 Current Status

- ✅ Git initialized with all files committed
- ✅ GitHub Actions workflows created
- ✅ Environment variable template created
- ✅ Vercel configuration file ready
- ⏳ Waiting for: GitHub repo creation + secrets
- ⏳ Waiting for: Vercel project setup + env vars
- ⏳ Waiting for: Supabase database deployment

---

## 🎉 Next Steps

1. Create GitHub repository (1 minute)
2. Add GitHub Secrets (2 minutes)
3. Set up Vercel project (2 minutes)
4. Set up Supabase database (5 minutes)
5. Push code (automated)
6. **Your app is live!** 🚀

Total time: ~10-15 minutes

---

For detailed guides, see:
- `docs/DEPLOYMENT_GUIDE.md` - Complete step-by-step
- `docs/GITHUB_SETUP.md` - GitHub details
- `docs/VERCEL_SETUP.md` - Vercel details
- `docs/SUPABASE_SETUP.md` - Supabase details
