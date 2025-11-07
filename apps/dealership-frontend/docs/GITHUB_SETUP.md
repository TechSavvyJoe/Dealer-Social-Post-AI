# GitHub Repository Setup Guide

## Step 1: Create a New Repository

### Option A: Using GitHub Web Interface

1. Go to [https://github.com/new](https://github.com/new)
2. Fill in repository details:
   - **Repository name**: `dealership-ai-sales-coach`
   - **Description**: "Enterprise-grade AI Sales Coach for automotive dealerships with real-time monitoring and coaching"
   - **Visibility**: Choose Private or Public
   - **DO NOT** initialize with README, .gitignore, or license (we already have these)
3. Click **"Create repository"**

### Option B: Using GitHub CLI

```bash
# Install GitHub CLI if you haven't: https://cli.github.com/
gh repo create dealership-ai-sales-coach \
  --private \
  --description "Enterprise-grade AI Sales Coach for automotive dealerships" \
  --source=. \
  --remote=origin
```

## Step 2: Initialize Git and Push Code

If you haven't already initialized git:

```bash
cd /Users/missionford/Downloads/dealership-ai-sales-coach

# Initialize git repository
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Enterprise AI Sales Coach with live monitoring"

# Add remote origin (replace YOUR_USERNAME with your GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/dealership-ai-sales-coach.git

# Push to GitHub
git branch -M main
git push -u origin main
```

## Step 3: Create .gitignore (if not exists)

Create a `.gitignore` file to prevent sensitive data from being committed:

```bash
# See the .gitignore file included in this project
# It already excludes:
# - node_modules
# - .env files
# - build directories
# - OS files
# - IDE files
```

## Step 4: Set Up Branch Protection

Protect your main branch to prevent accidental changes:

1. Go to your repository on GitHub
2. Click **Settings** → **Branches** (left sidebar)
3. Under "Branch protection rules", click **Add rule**
4. Configure:
   - **Branch name pattern**: `main`
   - ✅ Require a pull request before merging
   - ✅ Require approvals (set to 1 for team projects)
   - ✅ Require status checks to pass before merging
   - ✅ Require branches to be up to date before merging
   - ✅ Require conversation resolution before merging
   - ✅ Include administrators (optional, recommended)
5. Click **Create** or **Save changes**

## Step 5: Configure Repository Secrets

Add environment variables as GitHub Secrets for CI/CD:

1. Go to **Settings** → **Secrets and variables** → **Actions**
2. Click **New repository secret**
3. Add each of these secrets:

### Required Secrets:

```
VITE_SUPABASE_URL
  → Your Supabase project URL

VITE_SUPABASE_ANON_KEY
  → Your Supabase anon/public key

VITE_GEMINI_API_KEY
  → Your Google Gemini API key

VERCEL_TOKEN
  → Your Vercel deployment token (for automatic deployments)

VERCEL_ORG_ID
  → Your Vercel organization ID

VERCEL_PROJECT_ID
  → Your Vercel project ID
```

### How to Get These Values:

- **Supabase keys**: Settings → API in your Supabase dashboard
- **Gemini API**: [Google AI Studio](https://makersuite.google.com/app/apikey)
- **Vercel tokens**: Settings → Tokens in Vercel dashboard
- **Vercel IDs**: Project Settings → General in Vercel

## Step 6: Set Up GitHub Actions (Optional)

Create automated workflows for testing and deployment:

### Basic CI Workflow

This file is already included at `.github/workflows/ci.yml`:

- Runs on every push and pull request
- Installs dependencies
- Runs linting
- Builds the project
- Runs tests (when you add them)

### Auto-Deploy to Vercel Workflow

This file is already included at `.github/workflows/deploy.yml`:

- Automatically deploys to Vercel on push to main
- Creates preview deployments for pull requests

## Step 7: Set Up Collaborators (Team)

If working with a team:

1. Go to **Settings** → **Collaborators**
2. Click **Add people**
3. Enter GitHub usernames or emails
4. Choose permission level:
   - **Read**: View code only
   - **Write**: Push changes, create branches
   - **Admin**: Full repository access

## Step 8: Configure GitHub Pages (Documentation)

If you want to host documentation:

1. Go to **Settings** → **Pages**
2. Source: Deploy from a branch
3. Branch: `main` → `/docs` folder
4. Click **Save**
5. Your docs will be available at: `https://YOUR_USERNAME.github.io/dealership-ai-sales-coach`

## Step 9: Add Repository Topics

Help others discover your project:

1. Go to your repository main page
2. Click the gear icon next to "About"
3. Add topics:
   - `ai`
   - `sales`
   - `automotive`
   - `react`
   - `typescript`
   - `supabase`
   - `gemini-ai`
   - `real-time`
   - `dealership`
   - `coaching`

## Step 10: Create a Good README

The README.md is already included, but make sure to:

1. Update any placeholder text
2. Add screenshots or demo GIFs
3. Update installation instructions
4. Add your contact information
5. Include contribution guidelines

## Project Structure for GitHub

```
dealership-ai-sales-coach/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # Continuous Integration
│   │   └── deploy.yml          # Auto-deployment
│   └── ISSUE_TEMPLATE/         # Issue templates (optional)
├── docs/                        # Documentation
│   ├── SUPABASE_SETUP.md
│   ├── GITHUB_SETUP.md
│   └── VERCEL_SETUP.md
├── src/                         # Application source code
├── supabase/
│   └── schema.sql              # Database schema
├── .env.example                # Environment variable template
├── .gitignore                  # Git ignore rules
├── package.json                # Dependencies
├── README.md                   # Project documentation
└── vercel.json                 # Vercel configuration
```

## Git Workflow Best Practices

### For Solo Development:

```bash
# Work on a feature branch
git checkout -b feature/new-feature

# Make changes and commit frequently
git add .
git commit -m "Add new feature: description"

# Push to GitHub
git push origin feature/new-feature

# Merge back to main (on GitHub or locally)
git checkout main
git merge feature/new-feature
git push origin main
```

### For Team Development:

1. Create a feature branch
2. Make your changes
3. Push branch to GitHub
4. Open a Pull Request
5. Request review from team
6. Address feedback
7. Merge when approved
8. Delete feature branch

## Useful Git Commands

```bash
# Check status
git status

# View commit history
git log --oneline --graph

# Undo last commit (keep changes)
git reset --soft HEAD~1

# Discard all local changes
git reset --hard HEAD

# Update from remote
git pull origin main

# Create and switch to new branch
git checkout -b branch-name

# List all branches
git branch -a

# Delete local branch
git branch -d branch-name

# Delete remote branch
git push origin --delete branch-name
```

## GitHub Features to Enable

### Issues
- Enable Issues for bug tracking and feature requests
- Use labels: `bug`, `enhancement`, `documentation`, `help wanted`
- Create issue templates for consistency

### Projects
- Use GitHub Projects for roadmap planning
- Create boards for sprints or releases
- Link issues and pull requests

### Discussions
- Enable Discussions for community questions
- Separate from Issues for better organization

### Security
- Enable Dependabot alerts for vulnerable dependencies
- Set up code scanning (if public repository)
- Review security advisories

## Troubleshooting

### Authentication Issues

If you have trouble pushing:

```bash
# Use personal access token instead of password
# Generate at: https://github.com/settings/tokens

# Or use SSH (recommended)
ssh-keygen -t ed25519 -C "your_email@example.com"
# Add the public key to GitHub: Settings → SSH Keys
```

### Large File Issues

If you committed large files by accident:

```bash
# Remove from history
git filter-branch --tree-filter 'rm -f path/to/large/file' HEAD

# Or use BFG Repo-Cleaner
brew install bfg
bfg --delete-files large-file.extension
```

### Merge Conflicts

```bash
# Update your branch with latest main
git checkout main
git pull
git checkout your-branch
git merge main

# Resolve conflicts in your editor
# Then:
git add .
git commit -m "Resolve merge conflicts"
```

## Next Steps

After GitHub is configured:
1. ✅ Supabase database is ready
2. ✅ Code is version controlled on GitHub
3. ➡️ Set up Vercel deployment (see `VERCEL_SETUP.md`)
4. ➡️ Configure environment variables
5. ➡️ Deploy to production

## Resources

- [GitHub Docs](https://docs.github.com)
- [Git Documentation](https://git-scm.com/doc)
- [GitHub CLI](https://cli.github.com)
- [GitHub Actions](https://docs.github.com/en/actions)
