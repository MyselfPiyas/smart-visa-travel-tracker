import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import StatusPage from '../pages/StatusPage.jsx';
import { LandingPage, NotFoundPage } from '../pages/PlaceholderPages.jsx';
import { AuthPage } from '../pages/AuthPages.jsx';
import DashboardPage from '../pages/DashboardPage.jsx';
import MyDocumentsPage from '../pages/MyDocumentsPage.jsx';
import DocumentDetailsPage from '../pages/DocumentDetailsPage.jsx';
import DocumentFormPage from '../pages/DocumentFormPage.jsx';
import ReminderSettingsPage from '../pages/ReminderSettingsPage.jsx';
import NotificationHistoryPage from '../pages/NotificationHistoryPage.jsx';
import NotificationDetailsPage from '../pages/NotificationDetailsPage.jsx';
import AdminNotificationLogsPage from '../pages/AdminNotificationLogsPage.jsx';
import TravelHistoryPage from '../pages/TravelHistoryPage.jsx';
import TravelRecordDetailsPage from '../pages/TravelRecordDetailsPage.jsx';
import TravelRecordFormPage from '../pages/TravelRecordFormPage.jsx';
import DestinationChecklistPage from '../pages/DestinationChecklistPage.jsx';
import AdminDestinationRequirementsPage from '../pages/AdminDestinationRequirementsPage.jsx';
import AdminDashboardPage from '../pages/AdminDashboardPage.jsx';
import AdminUsersPage from '../pages/AdminUsersPage.jsx';
import AdminUserDetailsPage from '../pages/AdminUserDetailsPage.jsx';
import AdminSupportPage from '../pages/AdminSupportPage.jsx';
import AdminSupportDetailsPage from '../pages/AdminSupportDetailsPage.jsx';
import ProfileSettingsPage from '../pages/ProfileSettingsPage.jsx';
import { SupportPage, SupportDetailsPage } from '../pages/SupportPages.jsx';
import { AdminLayout, AppLayout, PublicLayout, TravelerLayout } from '../layouts/AppLayouts.jsx';
import { routes } from './routeConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { LoadingIndicator } from '../components/ui/index.jsx';

function RequireRole({ role }) {
  const { user, loading } = useAuth(); const location = useLocation();
  if (loading) return <main className="mx-auto max-w-3xl px-6 py-16"><LoadingIndicator label="Verifying your access…"/></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }}/>;
  if (user.role !== role) return <Navigate to={user.role === 'admin' ? '/admin/dashboard' : '/app/dashboard'} replace/>;
  return <Outlet/>;
}

export default function AppRoutes() {
  return <Routes><Route element={<AppLayout/>}>
    <Route element={<PublicLayout/>}><Route path={routes.home} element={<LandingPage/>}/><Route path={routes.register} element={<AuthPage register/>}/><Route path={routes.login} element={<AuthPage/>}/></Route>
    <Route path={routes.status} element={<StatusPage/>}/>
    <Route element={<RequireRole role="traveler"/>}><Route path={routes.traveler.root} element={<TravelerLayout/>}><Route index element={<Navigate to="dashboard" replace/>}/><Route path="dashboard" element={<DashboardPage/>}/><Route path="documents" element={<MyDocumentsPage/>}/><Route path="documents/upload" element={<DocumentFormPage/>}/><Route path="documents/:documentId/edit" element={<DocumentFormPage/>}/><Route path="documents/:documentId" element={<DocumentDetailsPage/>}/><Route path="reminders" element={<ReminderSettingsPage/>}/><Route path="notifications" element={<NotificationHistoryPage/>}/><Route path="notifications/:notificationId" element={<NotificationDetailsPage/>}/><Route path="travel-history" element={<TravelHistoryPage/>}/><Route path="travel-history/new" element={<TravelRecordFormPage/>}/><Route path="travel-history/:recordId/edit" element={<TravelRecordFormPage/>}/><Route path="travel-history/:recordId" element={<TravelRecordDetailsPage/>}/><Route path="checklist" element={<DestinationChecklistPage/>}/><Route path="profile" element={<ProfileSettingsPage/>}/><Route path="support" element={<SupportPage/>}/><Route path="support/:queryId" element={<SupportDetailsPage/>}/></Route></Route>
    <Route element={<RequireRole role="admin"/>}><Route path={routes.admin.root} element={<AdminLayout/>}><Route index element={<Navigate to="dashboard" replace/>}/><Route path="dashboard" element={<AdminDashboardPage/>}/><Route path="users" element={<AdminUsersPage/>}/><Route path="users/:userId" element={<AdminUserDetailsPage/>}/><Route path="notifications" element={<AdminNotificationLogsPage/>}/><Route path="destinations" element={<AdminDestinationRequirementsPage/>}/><Route path="support" element={<AdminSupportPage/>}/><Route path="support/:queryId" element={<AdminSupportDetailsPage/>}/></Route></Route>
    <Route path="*" element={<NotFoundPage/>}/>
  </Route></Routes>;
}
