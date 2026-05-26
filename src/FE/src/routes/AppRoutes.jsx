import { useEffect, useState } from 'react';
import ProtectedRoute from '../components/ProtectedRoute';
import RoleRoute from '../components/RoleRoute';
import AiCaseCreatorPage from '../pages/AiCaseCreatorPage';
import AdminDashboardPage from '../pages/AdminDashboardPage';
import AdminUsersPage from '../pages/AdminUsersPage';
import CaseListPage from '../pages/CaseListPage';
import CreateRoomPage from '../pages/CreateRoomPage';
import DashboardPage from '../pages/DashboardPage';
import GamePage from '../pages/GamePage';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import RegisterPage from '../pages/RegisterPage';
import RoomLobbyPage from '../pages/RoomLobbyPage';

function usePathname() {
  const [pathname, setPathname] = useState(window.location.pathname);

  useEffect(() => {
    const sync = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  return pathname;
}

export default function AppRoutes() {
  const pathname = usePathname();

  if (pathname === '/login') {
    return <LoginPage />;
  }

  if (pathname === '/register') {
    return <RegisterPage />;
  }

  if (pathname === '/dashboard') {
    return (
      <ProtectedRoute>
        <DashboardPage />
      </ProtectedRoute>
    );
  }

  if (pathname === '/cases') {
    return (
      <ProtectedRoute>
        <CaseListPage />
      </ProtectedRoute>
    );
  }

  if (pathname === '/rooms/create') {
    return (
      <ProtectedRoute>
        <CreateRoomPage />
      </ProtectedRoute>
    );
  }

  if (pathname === '/rooms/lobby') {
    return (
      <ProtectedRoute>
        <RoomLobbyPage />
      </ProtectedRoute>
    );
  }

  if (pathname === '/game') {
    return (
      <ProtectedRoute>
        <GamePage />
      </ProtectedRoute>
    );
  }

  if (pathname === '/admin/dashboard') {
    return (
      <RoleRoute roles={['ADMIN']}>
        <AdminDashboardPage />
      </RoleRoute>
    );
  }

  if (pathname === '/admin/users') {
    return (
      <RoleRoute roles={['ADMIN']}>
        <AdminUsersPage />
      </RoleRoute>
    );
  }

  if (pathname === '/admin/ai-cases') {
    return (
      <RoleRoute roles={['ADMIN']}>
        <AiCaseCreatorPage />
      </RoleRoute>
    );
  }

  return <HomePage />;
}
