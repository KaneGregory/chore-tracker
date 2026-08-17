import { BrowserRouter, Route, Routes } from 'react-router';
import { AuthProvider } from './context/AuthProvider';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AppShell } from './components/layout/AppShell';
import { RegisterPage } from './pages/RegisterPage';
import { LoginPage } from './pages/LoginPage';
import { HomePage } from './pages/HomePage';
import { CreateChorePage } from './pages/CreateChorePage';
import { ZonesPage } from './pages/ZonesPage';
import { MembersPage } from './pages/MembersPage';
import { SchedulesPage } from './pages/SchedulesPage';

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/chores/new" element={<CreateChorePage />} />
              <Route path="/zones" element={<ZonesPage />} />
              <Route path="/members" element={<MembersPage />} />
              <Route path="/schedules" element={<SchedulesPage />} />
            </Route>
          </Routes>
        </AppShell>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
