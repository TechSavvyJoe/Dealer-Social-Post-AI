# Supabase Database Schema
# This SQL script creates all necessary tables for the Dealership AI Sales Coach

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- USERS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role VARCHAR(50) NOT NULL CHECK (role IN ('salesman', 'manager')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

-- Add index on email for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

-- ============================================
-- SALESPEOPLE TABLE (Simplified user reference)
-- ============================================
CREATE TABLE IF NOT EXISTS salespeople (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_salespeople_user_id ON salespeople(user_id);

-- ============================================
-- SALES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  salesperson_id UUID NOT NULL REFERENCES salespeople(id) ON DELETE CASCADE,
  
  -- Sale metadata
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  duration INTEGER NOT NULL, -- in seconds
  
  -- Transcript data
  transcript JSONB NOT NULL DEFAULT '[]', -- Array of TranscriptSegment objects
  summary TEXT,
  
  -- Analysis data
  current_step VARCHAR(100),
  sentiment VARCHAR(50),
  success_probability INTEGER DEFAULT 0,
  
  -- Performance report (stored as JSONB for flexibility)
  performance_report JSONB,
  
  -- Coaching alerts
  coaching_alerts JSONB DEFAULT '[]',
  
  -- Audio metadata
  audio_level REAL DEFAULT 0,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_sales_salesperson_id ON sales(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_sales_timestamp ON sales(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_sales_success_probability ON sales(success_probability);

-- ============================================
-- LIVE_SALES TABLE (for real-time monitoring)
-- ============================================
CREATE TABLE IF NOT EXISTS live_sales (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  salesperson_id UUID NOT NULL REFERENCES salespeople(id) ON DELETE CASCADE,
  salesperson_name VARCHAR(255) NOT NULL,
  
  -- Status
  status VARCHAR(50) NOT NULL DEFAULT 'live',
  is_paused BOOLEAN DEFAULT FALSE,
  
  -- Real-time data
  duration INTEGER DEFAULT 0,
  audio_level REAL DEFAULT 0,
  success_probability INTEGER DEFAULT 0,
  sentiment VARCHAR(50) DEFAULT 'neutral',
  current_step VARCHAR(100),
  
  -- Live transcript
  transcript JSONB DEFAULT '[]',
  coaching_alerts JSONB DEFAULT '[]',
  
  -- Participants
  participants JSONB DEFAULT '{"salesperson": null, "customer": null}',
  
  -- Dashboard data
  dashboard_data JSONB,
  
  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc', NOW())
);

CREATE INDEX IF NOT EXISTS idx_live_sales_salesperson_id ON live_sales(salesperson_id);
CREATE INDEX IF NOT EXISTS idx_live_sales_status ON live_sales(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_live_sales_active_salesperson ON live_sales(salesperson_id) 
  WHERE status = 'live';

-- ============================================
-- FUNCTIONS FOR UPDATED_AT TIMESTAMPS
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = TIMEZONE('utc', NOW());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sales_updated_at BEFORE UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_live_sales_updated_at BEFORE UPDATE ON live_sales
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE salespeople ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE live_sales ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view their own data"
  ON users FOR SELECT
  USING (auth.uid()::text = id::text);

CREATE POLICY "Users can update their own data"
  ON users FOR UPDATE
  USING (auth.uid()::text = id::text);

-- Salespeople policies (managers can see all, salespeople see themselves)
CREATE POLICY "Managers can view all salespeople"
  ON salespeople FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'manager'
    )
  );

CREATE POLICY "Salespeople can view their own data"
  ON salespeople FOR SELECT
  USING (user_id = auth.uid());

-- Sales policies
CREATE POLICY "Managers can view all sales"
  ON sales FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'manager'
    )
  );

CREATE POLICY "Salespeople can view their own sales"
  ON sales FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM salespeople 
      WHERE salespeople.id = sales.salesperson_id 
      AND salespeople.user_id = auth.uid()
    )
  );

CREATE POLICY "Salespeople can insert their own sales"
  ON sales FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM salespeople 
      WHERE salespeople.id = sales.salesperson_id 
      AND salespeople.user_id = auth.uid()
    )
  );

-- Live sales policies
CREATE POLICY "Managers can view all live sales"
  ON live_sales FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users 
      WHERE users.id = auth.uid() 
      AND users.role = 'manager'
    )
  );

CREATE POLICY "Salespeople can view all live sales"
  ON live_sales FOR SELECT
  USING (true); -- All salespeople can see each other's live sales

CREATE POLICY "Salespeople can manage their own live sales"
  ON live_sales FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM salespeople 
      WHERE salespeople.id = live_sales.salesperson_id 
      AND salespeople.user_id = auth.uid()
    )
  );

-- ============================================
-- SAMPLE DATA (OPTIONAL - for testing)
-- ============================================

-- Insert sample users
INSERT INTO users (id, email, name, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'manager@dealership.com', 'Sarah Johnson', 'manager'),
  ('22222222-2222-2222-2222-222222222222', 'john@dealership.com', 'John Smith', 'salesman'),
  ('33333333-3333-3333-3333-333333333333', 'mary@dealership.com', 'Mary Williams', 'salesman')
ON CONFLICT (email) DO NOTHING;

-- Insert sample salespeople
INSERT INTO salespeople (id, user_id, name, email) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '22222222-2222-2222-2222-222222222222', 'John Smith', 'john@dealership.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '33333333-3333-3333-3333-333333333333', 'Mary Williams', 'mary@dealership.com')
ON CONFLICT DO NOTHING;

-- ============================================
-- REALTIME SUBSCRIPTIONS
-- ============================================
-- Enable realtime for live sales monitoring
ALTER PUBLICATION supabase_realtime ADD TABLE live_sales;
ALTER PUBLICATION supabase_realtime ADD TABLE sales;

-- ============================================
-- VIEWS FOR ANALYTICS
-- ============================================

-- View for team performance summary
CREATE OR REPLACE VIEW team_performance AS
SELECT 
  s.id as salesperson_id,
  s.name as salesperson_name,
  COUNT(sa.id) as total_sales,
  AVG(sa.success_probability) as avg_success_rate,
  AVG(sa.duration) as avg_duration,
  AVG((sa.performance_report->>'overallScore')::numeric) as avg_performance_score,
  MAX(sa.timestamp) as last_sale_date
FROM salespeople s
LEFT JOIN sales sa ON s.id = sa.salesperson_id
GROUP BY s.id, s.name;

-- View for recent sales summary
CREATE OR REPLACE VIEW recent_sales AS
SELECT 
  sa.id,
  sa.timestamp,
  sa.duration,
  sa.success_probability,
  sa.sentiment,
  sa.current_step,
  sp.name as salesperson_name,
  sp.id as salesperson_id,
  (sa.performance_report->>'overallScore')::numeric as performance_score
FROM sales sa
JOIN salespeople sp ON sa.salesperson_id = sp.id
ORDER BY sa.timestamp DESC
LIMIT 100;

COMMENT ON TABLE users IS 'Application users (managers and salespeople)';
COMMENT ON TABLE salespeople IS 'Salesperson profiles linked to users';
COMMENT ON TABLE sales IS 'Completed sales records with transcripts and analysis';
COMMENT ON TABLE live_sales IS 'Real-time sales currently in progress';
COMMENT ON VIEW team_performance IS 'Aggregated performance metrics per salesperson';
COMMENT ON VIEW recent_sales IS 'Latest 100 sales with key metrics';
