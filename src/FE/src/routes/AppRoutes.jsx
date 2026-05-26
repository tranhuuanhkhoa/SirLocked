import { useEffect, useState } from 'react';
import ProtectedRoute from '../components/ProtectedRoute';
import RoleRoute from '../components/RoleRoute';
import AdminCaseDetailPage from '../pages/AdminCaseDetailPage';
import AiCaseCreatorPage from '../pages/AiCaseCreatorPage';
import AdminDashboardPage from '../pages/AdminDashboardPage';
import AdminRoomHistoryPage from '../pages/AdminRoomHistoryPage';
import AdminUsersPage from '../pages/AdminUsersPage';
import CaseDetailPage from '../pages/CaseDetailPage';
import CaseListPage from '../pages/CaseListPage';
import CreateRoomPage from '../pages/CreateRoomPage';
import DashboardPage from '../pages/DashboardPage';
import GamePage from '../pages/GamePage';
import HomePage from '../pages/HomePage';
import LoginPage from '../pages/LoginPage';
import ProfilePage from '../pages/ProfilePage';
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

  if (pathname === '/profile') {
    return (
      <ProtectedRoute>
        <ProfilePage />
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

  if (pathname === '/cases/detail') {
    return (
      <ProtectedRoute>
        <CaseDetailPage />
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

  if (pathname === '/admin/rooms') {
    return (
      <RoleRoute roles={['ADMIN']}>
        <AdminRoomHistoryPage />
      </RoleRoute>
    );
  }

  if (pathname === '/admin/cases/detail') {
    return (
      <RoleRoute roles={['ADMIN']}>
        <AdminCaseDetailPage />
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
