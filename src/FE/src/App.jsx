import { AuthProvider } from './contexts/AuthContext';
import AppLayout from './layouts/AppLayout';
import AppRoutes from './routes/AppRoutes';
import './styles/app.css';

export default function App() {
  return (
    <AuthProvider>
      <AppLayout>
        <AppRoutes />
      </AppLayout>
    </AuthProvider>
  );
}
