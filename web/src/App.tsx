import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useVault } from './context/VaultContext.tsx';
import CollectionPage from './pages/CollectionPage.tsx';
import LoginPage from './pages/LoginPage.tsx';
import RegisterPage from './pages/RegisterPage.tsx';
import VaultPage from './pages/VaultPage.tsx';
import Spinner from './components/Spinner.tsx';

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isLocked, isLoading } = useVault();
  if (isLoading) return <FullScreenSpinner />;
  if (isLocked) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function PublicRoute({ children }: { children: ReactNode }) {
  const { isLocked } = useVault();
  if (!isLocked) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function FullScreenSpinner() {
  return (
    <div className="min-h-screen bg-vault-bg flex items-center justify-center">
      <Spinner size="lg" />
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login"    element={<PublicRoute><LoginPage /></PublicRoute>} />
      <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />
      <Route path="/" element={<ProtectedRoute><VaultPage /></ProtectedRoute>} />
      <Route
        path="/collections/:id"
        element={<ProtectedRoute><CollectionPage /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
