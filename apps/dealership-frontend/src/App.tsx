import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useThemeStore } from './stores/themeStore';
import { Toaster } from './components/ui/toast';

// Import pages (we'll create these next)
import LoginPage from './pages/LoginPage';
import SalesmanDashboard from './pages/SalesmanDashboard';
import ManagerDashboard from './pages/ManagerDashboard';
import { USER_ROLES } from './config/constants';

function App() {
  const { isAuthenticated, user, logout } = useAuthStore();
  const { theme } = useThemeStore();

  console.log('[App] Rendering, isAuthenticated:', isAuthenticated, 'user:', user);

  useEffect(() => {
    // Apply theme on mount
    const root = window.document.documentElement;
    const effectiveTheme = theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
      : theme;

    root.classList.remove('light', 'dark');
    root.classList.add(effectiveTheme);
  }, [theme]);

  // If authenticated but user has no role, clear auth (old/corrupt data)
  useEffect(() => {
    if (isAuthenticated && user && !user.role) {
      console.warn('[App] User has no role, clearing auth');
      logout();
    }
  }, [isAuthenticated, user, logout]);

  if (!isAuthenticated || !user?.role) {
    return (
      <>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
        <Toaster />
      </>
    );
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<Navigate to="/" replace />} />

        {user?.role === USER_ROLES.SALESPERSON && (
          <>
            <Route path="/" element={<SalesmanDashboard />} />
            <Route path="/dashboard" element={<SalesmanDashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}

        {user?.role === USER_ROLES.MANAGER && (
          <>
            <Route path="/" element={<ManagerDashboard />} />
            <Route path="/dashboard" element={<ManagerDashboard />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Toaster />
    </>
  );
}

export default App;
