# Supabase Setup Guide

## Step 1: Create a Supabase Project

1. Go to [https://supabase.com](https://supabase.com)
2. Sign up or log in to your account
3. Click **"New Project"**
4. Fill in the project details:
   - **Name**: `dealership-ai-sales-coach`
   - **Database Password**: Choose a strong password (save this!)
   - **Region**: Choose closest to your users
   - **Pricing Plan**: Free tier is sufficient to start
5. Click **"Create new project"**
6. Wait 2-3 minutes for the project to be provisioned

## Step 2: Run Database Schema

1. In your Supabase dashboard, go to **SQL Editor** (left sidebar)
2. Click **"New Query"**
3. Copy the entire contents of `supabase/schema.sql` from this repository
4. Paste it into the SQL editor
5. Click **"Run"** or press `Cmd/Ctrl + Enter`
6. Verify success - you should see: "Success. No rows returned"

### What This Creates:
- ✅ **users** table - Authentication and role management
- ✅ **salespeople** table - Salesperson profiles
- ✅ **sales** table - Completed sales records with transcripts
- ✅ **live_sales** table - Real-time sales monitoring
- ✅ **Views** - team_performance and recent_sales analytics
- ✅ **RLS Policies** - Row-level security for data protection
- ✅ **Triggers** - Automatic timestamp updates
- ✅ **Indexes** - Optimized query performance

## Step 3: Configure Authentication

### Enable Email Authentication
1. Go to **Authentication** → **Providers** (left sidebar)
2. Enable **Email** provider
3. Configure settings:
   - ✅ Enable email confirmations (optional, recommended for production)
   - ✅ Enable email auto-confirm for development
   - Set **Site URL**: `http://localhost:3000` (development) or your domain (production)
   - Add **Redirect URLs**: 
     - `http://localhost:3000`
     - `https://your-domain.vercel.app` (add when deployed)

### Configure Email Templates (Optional)
1. Go to **Authentication** → **Email Templates**
2. Customize the confirmation and password reset emails with your branding

## Step 4: Get Your API Keys

1. Go to **Settings** → **API** (left sidebar)
2. Copy these values (you'll need them for `.env` file):

```
Project URL: https://xxxxxxxxxxxxx.supabase.co
anon public key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
service_role key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

⚠️ **IMPORTANT**: 
- The `anon public` key is safe to use in your frontend
- The `service_role` key should NEVER be exposed in frontend code (use only in backend/serverless functions)

## Step 5: Configure Realtime (for Live Sales)

1. Go to **Database** → **Replication** (left sidebar)
2. Find the **live_sales** table
3. Enable replication by toggling it ON
4. Also enable replication for **sales** table if you want real-time updates

This allows managers to see live sales updates in real-time without polling.

## Step 6: Set Up Storage (Optional - for future audio recordings)

If you plan to store actual audio recordings:

1. Go to **Storage** (left sidebar)
2. Click **"New bucket"**
3. Create a bucket named `sales-recordings`
4. Set it to **Private** (RLS will control access)
5. Configure storage policies:

```sql
-- Allow authenticated users to upload their own recordings
CREATE POLICY "Users can upload their own recordings"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'sales-recordings' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow authenticated users to read their own recordings
CREATE POLICY "Users can view their own recordings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'sales-recordings' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- Allow managers to view all recordings
CREATE POLICY "Managers can view all recordings"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'sales-recordings' 
  AND EXISTS (
    SELECT 1 FROM users 
    WHERE users.id = auth.uid() 
    AND users.role = 'manager'
  )
);
```

## Step 7: Test the Setup

### Using SQL Editor
Run this query to verify everything works:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_type = 'BASE TABLE';

-- Check sample data
SELECT * FROM users;
SELECT * FROM salespeople;

-- Check views
SELECT * FROM team_performance;
```

### Using the Application
1. Set up your environment variables (see `.env.example`)
2. Start your development server
3. Try logging in with sample credentials:
   - Manager: `manager@dealership.com`
   - Salesperson: `john@dealership.com`

## Step 8: Production Checklist

Before going live:

- [ ] Change all sample passwords
- [ ] Enable email confirmations
- [ ] Set up custom email domain (optional)
- [ ] Configure proper redirect URLs for your production domain
- [ ] Review and test all RLS policies
- [ ] Set up database backups (automatic on paid plans)
- [ ] Enable database branching for safe schema changes (paid feature)
- [ ] Set up monitoring and alerts
- [ ] Review security settings in **Settings** → **Security**

## Useful Supabase Dashboard Sections

- **Table Editor**: Browse and edit data directly
- **SQL Editor**: Run custom queries and migrations
- **Database** → **Extensions**: Enable PostgreSQL extensions
- **Database** → **Functions**: Create custom database functions
- **Auth** → **Users**: Manage user accounts
- **Logs**: View authentication and database logs
- **Settings** → **Billing**: Monitor usage and upgrade plans

## Troubleshooting

### "relation does not exist" Error
- Make sure you ran the schema.sql file completely
- Check the SQL Editor for any error messages
- Verify you're in the correct project

### RLS Policy Issues
- Test policies using the SQL editor with different auth contexts
- Use `auth.uid()` to see current user in queries
- Check if RLS is enabled: `ALTER TABLE table_name ENABLE ROW LEVEL SECURITY;`

### Realtime Not Working
- Ensure replication is enabled for the table
- Check that you've subscribed to the correct table in your code
- Verify your subscription includes the correct filters

## Next Steps

After Supabase is configured:
1. ✅ Set up GitHub repository (see `GITHUB_SETUP.md`)
2. ✅ Configure Vercel deployment (see `VERCEL_SETUP.md`)
3. ✅ Add environment variables to your app (see `.env.example`)

## Support

- [Supabase Documentation](https://supabase.com/docs)
- [Supabase Discord Community](https://discord.supabase.com)
- [Supabase GitHub Discussions](https://github.com/supabase/supabase/discussions)
