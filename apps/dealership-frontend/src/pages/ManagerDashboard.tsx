import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { useAuthStore } from '../stores/authStore';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Progress } from '../components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { TranscriptDisplay } from '../components/features/TranscriptDisplay';
import { CoachingAlertsList } from '../components/features/CoachingAlert';
import { AudioLevelIndicator } from '../components/features/AudioWaveform';
import { SalesHistory } from '../components/features/SalesHistory';
import { PerformanceOverTimeChart, SalesStepChart } from '../components/features/AnalyticsCharts';
import {
  LogOut, Users, Activity, TrendingUp, Handshake, Clock,
  AlertCircle, Target, MessageSquare, Eye, X, BarChart3,
  ClipboardList, Settings, UserCog, Sparkles, Shield
} from 'lucide-react';
import { subscribeLiveSales, unsubscribeLiveSales, getSalespeople, getRecentSales, getAllUsers, createUser, updateUser, deleteUser } from '../services/dataService';
import { ThemeToggleInline } from '../components/ui/theme-toggle';
import type { LiveSaleData, Salesperson, SavedSale } from '../types';
import { formatDuration, formatDate } from '../lib/utils';
import { SALES_STEPS } from '../config/constants';
import { UserManagement } from '../components/features/UserManagement';

export default function ManagerDashboard() {
  const { user, logout } = useAuthStore();
  const [liveSales, setLiveSales] = useState<LiveSaleData[]>([]);
  const [salespeople, setSalespeople] = useState<Salesperson[]>([]);
  const [allSales, setAllSales] = useState<SavedSale[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedSale, setSelectedSale] = useState<LiveSaleData | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('dashboard');

    // Load salespeople and sales history
  useEffect(() => {
    loadSalespeople();
    loadAllSales();
    loadUsers();
  }, []);

  const loadSalespeople = async () => {
    try {
      const data = await getSalespeople();
      console.log('[ManagerDashboard] loadSalespeople - raw data:', data);
      console.log('[ManagerDashboard] loadSalespeople - count:', data?.length || 0);
      setSalespeople(Array.isArray(data) ? data as any : []);
    } catch (err) {
      console.error('[ManagerDashboard] Failed to load salespeople:', err);
      setSalespeople([]);
    }
  };

  const loadAllSales = async () => {
    try {
      const sales = await getRecentSales();
      setAllSales(Array.isArray(sales?.items) ? sales.items as any : []);
    } catch (err) {
      console.error('Failed to load sales:', err);
      setAllSales([]);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await getAllUsers();
      console.log('[ManagerDashboard] loadUsers - raw data:', data);
      console.log('[ManagerDashboard] loadUsers - count:', data?.length || 0);
      setUsers(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('[ManagerDashboard] Failed to load users:', err);
      setUsers([]);
    }
  };

  const handleCreateUser = async (email: string, password: string, role: 'manager' | 'salesman', name?: string) => {
    try {
      await createUser(email, password, role, name);
      await loadUsers(); // Refresh users list after creation
    } catch (error) {
      console.error('Failed to create user:', error);
      throw error; // Re-throw so UserManagement component can show error
    }
  };

  const handleUpdateUser = async (id: string, email: string, role: 'manager' | 'salesman', name?: string) => {
    try {
      await updateUser(id, email, role, name);
      await loadUsers(); // Refresh users list after update
    } catch (error) {
      console.error('Failed to update user:', error);
      throw error; // Re-throw so UserManagement component can show error
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await deleteUser(id);
      await loadUsers(); // Refresh users list after deletion
    } catch (error) {
      console.error('Failed to delete user:', error);
      throw error; // Re-throw so UserManagement component can show error
    }
  };

  // Subscribe to live sale updates
  useEffect(() => {
    subscribeLiveSales((sales) => {
      setLiveSales(Array.isArray(sales) ? sales as any : []);
    });

    return () => {
      unsubscribeLiveSales();
    };
  }, []);

  // Calculate stats
  const activeSales = liveSales.length;
  const activeSalespeople = new Set(liveSales.map(c => c.salespersonId)).size;
  const avgSuccessRate = liveSales.length > 0
    ? Math.round(liveSales.reduce((sum, call) => sum + call.successProbability, 0) / liveSales.length)
    : 0;

  const handleViewSale = (call: LiveSaleData) => {
    setSelectedSale(call);
    setIsDetailOpen(true);
  };

  const getSalespersonName = (id: string) => {
    return salespeople.find(s => s.id === id)?.name || 'Unknown';
  };

  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return 'text-green-500';
      case 'neutral': return 'text-yellow-500';
      case 'negative': return 'text-red-500';
      default: return 'text-muted-foreground';
    }
  };

  const getSentimentIcon = (sentiment: string) => {
    switch (sentiment) {
      case 'positive': return '😊';
      case 'neutral': return '😐';
      case 'negative': return '😟';
      default: return '—';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-card/50 backdrop-blur-xl sticky top-0 z-40">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Manager Hub</h1>
              <p className="text-sm text-muted-foreground">Welcome back, {user?.name}!</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {activeSales > 0 && (
              <Badge variant="default" className="animate-pulse">
                <Activity className="w-3 h-3 mr-1" />
                {activeSales} Live
              </Badge>
            )}
            <ThemeToggleInline />
            <Button variant="ghost" onClick={logout}>
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content with Tabs */}
      <main className="container mx-auto px-4 py-8">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full max-w-2xl mx-auto grid-cols-5">
            <TabsTrigger value="dashboard">
              <Activity className="w-4 h-4 mr-2" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="history">
              <ClipboardList className="w-4 h-4 mr-2" />
              History
            </TabsTrigger>
            <TabsTrigger value="analytics">
              <BarChart3 className="w-4 h-4 mr-2" />
              Analytics
            </TabsTrigger>
            <TabsTrigger value="team">
              <Users className="w-4 h-4 mr-2" />
              Team
            </TabsTrigger>
            <TabsTrigger value="settings">
              <Settings className="w-4 h-4 mr-2" />
              Settings
            </TabsTrigger>
          </TabsList>

          {/* Dashboard Tab - Live Sales */}
          <TabsContent value="dashboard" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="space-y-6"
            >
              {/* Stats Grid */}
              <div className="grid md:grid-cols-3 gap-6">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                >
                  <Card className="border-primary/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Active Salespeople</CardTitle>
                      <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-primary">{activeSalespeople}</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {activeSalespeople === 0 ? 'Currently idle' : `${activeSalespeople} in sales`}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                >
                  <Card className="border-green-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Live Sales</CardTitle>
                      <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-green-500">{activeSales}</div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {activeSales === 0 ? 'No active sales' : 'In progress'}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 }}
                >
                  <Card className="border-blue-500/20">
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <CardTitle className="text-sm font-medium">Avg Success Rate</CardTitle>
                      <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-blue-500">
                        {avgSuccessRate > 0 ? `${avgSuccessRate}%` : '--'}
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        {avgSuccessRate > 0 ? 'Across all active sales' : 'No data yet'}
                      </p>
                    </CardContent>
                  </Card>
                </motion.div>
              </div>

              {/* Live Sales Grid */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Handshake className="w-5 h-5" />
                        Live Sales Monitor
                      </CardTitle>
                      <CardDescription>Monitor active sales interactions in real-time</CardDescription>
                    </div>
                    {activeSales > 0 && (
                      <Badge variant="default" className="animate-pulse">
                        <Activity className="w-3 h-3 mr-1" />
                        {activeSales} Active
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  {liveSales.length === 0 ? (
                    <div className="text-center py-12">
                      <Handshake className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <p className="text-sm text-muted-foreground">
                        No active sales. Team members will appear here when they start recording.
                      </p>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      <AnimatePresence mode="popLayout">
                        {liveSales.map((call) => (
                          <motion.div
                            key={call.salespersonId}
                            layout
                            initial={{ opacity: 0, scale: 0.9 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.9 }}
                            transition={{ duration: 0.2 }}
                          >
                            <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent hover:border-primary/50 transition-colors">
                              <CardHeader className="pb-3">
                                <div className="flex items-start justify-between">
                                  <div className="flex-1 min-w-0">
                                    <CardTitle className="text-base truncate">
                                      {getSalespersonName(call.salespersonId)}
                                    </CardTitle>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge variant="outline" className="text-xs">
                                        <Clock className="w-3 h-3 mr-1" />
                                        {formatDuration(call.duration)}
                                      </Badge>
                                      <Badge
                                        variant={call.isPaused ? 'secondary' : 'default'}
                                        className={call.isPaused ? '' : 'animate-pulse'}
                                      >
                                        {call.isPaused ? 'Paused' : 'Live'}
                                      </Badge>
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleViewSale(call)}
                                    className="shrink-0"
                                  >
                                    <Eye className="w-4 h-4" />
                                  </Button>
                                </div>
                              </CardHeader>
                              <CardContent className="space-y-3">
                                {/* Audio Level */}
                                <div>
                                  <div className="text-xs text-muted-foreground mb-1">Audio Level</div>
                                  <AudioLevelIndicator level={call.audioLevel} />
                                </div>

                                {/* Success Probability */}
                                <div>
                                  <div className="flex items-center justify-between text-xs mb-1">
                                    <span className="text-muted-foreground">Success Probability</span>
                                    <span className="font-medium">{call.successProbability}%</span>
                                  </div>
                                  <Progress value={call.successProbability} className="h-2" />
                                </div>

                                {/* Current Step */}
                                <div className="flex items-center gap-2">
                                  <Target className="w-4 h-4 text-muted-foreground" />
                                  <div className="flex-1 min-w-0">
                                    <div className="text-xs text-muted-foreground">Current Step</div>
                                    <div className="text-sm font-medium truncate">
                                      {call.currentStep || 'Unknown'}
                                    </div>
                                  </div>
                                </div>

                                {/* Sentiment */}
                                <div className="flex items-center gap-2">
                                  <MessageSquare className="w-4 h-4 text-muted-foreground" />
                                  <div className="flex-1">
                                    <div className="text-xs text-muted-foreground">Sentiment</div>
                                    <div className={`text-sm font-medium flex items-center gap-1 ${getSentimentColor(call.sentiment)}`}>
                                      <span>{getSentimentIcon(call.sentiment)}</span>
                                      <span className="capitalize">{call.sentiment}</span>
                                    </div>
                                  </div>
                                </div>

                                {/* Alerts Count */}
                                {call.coachingAlerts.length > 0 && (
                                  <div className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
                                    <AlertCircle className="w-4 h-4" />
                                    <span className="text-xs font-medium">
                                      {call.coachingAlerts.length} coaching alert{call.coachingAlerts.length !== 1 ? 's' : ''}
                                    </span>
                                  </div>
                                )}
                              </CardContent>
                            </Card>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          {/* History Tab */}
          <TabsContent value="history" className="space-y-6">
            <SalesHistory 
              sales={allSales} 
              onSaleDeleted={loadAllSales}
            />
          </TabsContent>

          {/* Analytics Tab */}
          <TabsContent value="analytics" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Team Performance Analytics
                  </CardTitle>
                  <CardDescription>
                    Comprehensive insights into team sales performance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-6">
                    {/* Performance metrics summary */}
                    <div className="grid md:grid-cols-4 gap-4">
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <div className="text-2xl font-bold">{salespeople.length}</div>
                            <div className="text-xs text-muted-foreground mt-1">Total Team Members</div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <div className="text-2xl font-bold">{allSales.length}</div>
                            <div className="text-xs text-muted-foreground mt-1">Total Sales</div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <div className="text-2xl font-bold">
                              {allSales.length > 0 ? Math.round(allSales.reduce((sum, s) => sum + (s.performanceReport?.overallScore || 0), 0) / allSales.length) : 0}%
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">Avg Performance</div>
                          </div>
                        </CardContent>
                      </Card>
                      <Card>
                        <CardContent className="pt-6">
                          <div className="text-center">
                            <div className="text-2xl font-bold">
                              {allSales.length > 0 ? formatDuration(Math.round(allSales.reduce((sum, s) => sum + s.duration, 0) / allSales.length)) : '--'}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">Avg Duration</div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Placeholder for charts - can be enhanced with real data */}
                    <div className="text-center py-12 border-2 border-dashed rounded-lg">
                      <BarChart3 className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <p className="text-sm text-muted-foreground mb-2">
                        Advanced analytics charts coming soon
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Performance trends, sales step analysis, and more
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <UserCog className="w-5 h-5" />
                    Team Management
                  </CardTitle>
                  <CardDescription>
                    Manage your sales team and view individual performance
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <UserManagement
                    users={users}
                    onCreateUser={handleCreateUser}
                    onUpdateUser={handleUpdateUser}
                    onDeleteUser={handleDeleteUser}
                    onRefresh={loadUsers}
                    currentUserId={user?.id}
                  />
                  
                  {/* Salespeople display below user management */}
                  {salespeople.length === 0 ? (
                    <div className="text-center py-12">
                      <Users className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <p className="text-sm text-muted-foreground">
                        No team members found. Team members will appear here once they log in.
                      </p>
                    </div>
                  ) : (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                      {salespeople.map((person) => {
                        const personSales = allSales.filter(s => s.salespersonId === person.id);
                        const avgScore = personSales.length > 0
                          ? Math.round(personSales.reduce((sum, s) => sum + (s.performanceReport?.overallScore || 0), 0) / personSales.length)
                          : 0;
                        const isActive = liveSales.some(s => s.salespersonId === person.id);

                        return (
                          <Card key={person.id} className={isActive ? 'border-primary/50' : ''}>
                            <CardHeader className="pb-3">
                              <div className="flex items-center justify-between">
                                <div>
                                  <CardTitle className="text-base">{person.name}</CardTitle>
                                  <p className="text-xs text-muted-foreground">{person.email}</p>
                                </div>
                                {isActive && (
                                  <Badge variant="default" className="animate-pulse">Live</Badge>
                                )}
                              </div>
                            </CardHeader>
                            <CardContent className="space-y-3">
                              <div className="grid grid-cols-2 gap-2 text-sm">
                                <div>
                                  <div className="text-xs text-muted-foreground">Total Sales</div>
                                  <div className="font-semibold">{personSales.length}</div>
                                </div>
                                <div>
                                  <div className="text-xs text-muted-foreground">Avg Score</div>
                                  <div className="font-semibold">{avgScore}%</div>
                                </div>
                              </div>
                              {avgScore > 0 && (
                                <Progress value={avgScore} className="h-2" />
                              )}
                            </CardContent>
                          </Card>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings" className="space-y-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-6"
            >
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="w-5 h-5" />
                    Manager Settings
                  </CardTitle>
                  <CardDescription>
                    Configure your preferences and system settings
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-6">
                    {/* Profile Section */}
                    <div>
                      <h3 className="text-sm font-medium mb-3">Profile</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between py-2 border-b">
                          <span className="text-muted-foreground">Name</span>
                          <span className="font-medium">{user?.name}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b">
                          <span className="text-muted-foreground">Email</span>
                          <span className="font-medium">{user?.email}</span>
                        </div>
                        <div className="flex justify-between py-2 border-b">
                          <span className="text-muted-foreground">Role</span>
                          <Badge variant="default">Manager</Badge>
                        </div>
                      </div>
                    </div>

                    {/* Notification Preferences */}
                    <div>
                      <h3 className="text-sm font-medium mb-3">Notifications</h3>
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Coaching Alerts</div>
                            <div className="text-xs text-muted-foreground">Get notified when coaching alerts are triggered</div>
                          </div>
                          <Badge variant="outline">Coming Soon</Badge>
                        </div>
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-sm font-medium">Sale Updates</div>
                            <div className="text-xs text-muted-foreground">Real-time updates for active sales</div>
                          </div>
                          <Badge variant="outline">Coming Soon</Badge>
                        </div>
                      </div>
                    </div>

                    {/* Theme */}
                    <div>
                      <h3 className="text-sm font-medium mb-3">Appearance</h3>
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium">Theme</div>
                          <div className="text-xs text-muted-foreground">Toggle between light and dark mode</div>
                        </div>
                        <ThemeToggleInline />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          </TabsContent>
        </Tabs>
      </main>

      {/* Sale Detail Dialog */}
      <Dialog open={isDetailOpen} onOpenChange={setIsDetailOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          {selectedSale && (
            <>
              <DialogHeader>
                <div className="flex items-center justify-between">
                  <DialogTitle className="flex items-center gap-2">
                    <Handshake className="w-5 h-5" />
                    {getSalespersonName(selectedSale.salespersonId)}
                  </DialogTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={selectedSale.isPaused ? 'secondary' : 'default'}>
                      {selectedSale.isPaused ? 'Paused' : 'Live'}
                    </Badge>
                    <Badge variant="outline">
                      <Clock className="w-3 h-3 mr-1" />
                      {formatDuration(selectedSale.duration)}
                    </Badge>
                  </div>
                </div>
              </DialogHeader>

              <div className="space-y-6 mt-4">
                {/* Metrics Grid */}
                <div className="grid md:grid-cols-3 gap-4">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-center">
                        <div className="text-3xl font-bold text-primary mb-1">
                          {selectedSale.successProbability}%
                        </div>
                        <div className="text-xs text-muted-foreground">Success Probability</div>
                        <Progress value={selectedSale.successProbability} className="h-2 mt-2" />
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-center">
                        <div className="text-xl font-semibold mb-1">
                          {selectedSale.currentStep || 'Unknown'}
                        </div>
                        <div className="text-xs text-muted-foreground">Current Step</div>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-center">
                        <div className={`text-xl font-semibold mb-1 flex items-center justify-center gap-2 ${getSentimentColor(selectedSale.sentiment)}`}>
                          <span>{getSentimentIcon(selectedSale.sentiment)}</span>
                          <span className="capitalize">{selectedSale.sentiment}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">Customer Sentiment</div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Audio Level */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">Audio Level</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AudioLevelIndicator level={selectedSale.audioLevel} />
                  </CardContent>
                </Card>

                {/* Coaching Alerts */}
                {selectedSale.coachingAlerts.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        Coaching Alerts ({selectedSale.coachingAlerts.length})
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <CoachingAlertsList
                        alerts={selectedSale.coachingAlerts}
                        onDismiss={() => {}} // Read-only for manager
                      />
                    </CardContent>
                  </Card>
                )}

                {/* Live Transcript */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Live Transcript ({selectedSale.transcript.length} messages)
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {selectedSale.transcript.length > 0 ? (
                      <TranscriptDisplay
                        segments={selectedSale.transcript}
                        isLive={!selectedSale.isPaused}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-8">
                        No transcript yet. Transcript will appear as the conversation progresses.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
