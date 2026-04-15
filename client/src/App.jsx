import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";

const Authpage = lazy(() => import("./pages/Authpage"));
const OwnerDashboard = lazy(() => import("./pages/Ownerdashboard"));
const TenantDashboard = lazy(() => import("./pages/Tenantdashboard"));
const PropertiesList = lazy(() => import("./pages/PropertiesList"));
const AddProperty = lazy(() => import("./pages/AddProperty"));
const EditProperty = lazy(() => import("./pages/EditProperty"));
const PropertyDetail = lazy(() => import("./pages/PropertyDetail"));
const LeaseManagement = lazy(() => import("./pages/LeaseManagement"));
const OwnerPayments = lazy(() => import("./pages/OwnerPayments"));
const OwnerMaintenance = lazy(() => import("./pages/OwnerMaintenance"));
const OwnerDocuments = lazy(() => import("./pages/OwnerDocuments"));
const TenantSearch = lazy(() => import("./pages/TenantSearch"));
const TenantPropertyDetail = lazy(() => import("./pages/TenantPropertyDetail"));
const TenantApply = lazy(() => import("./pages/TenantApply"));

function RedirectByRole() {
  const { isLoggedIn, role } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/auth" replace />;
  }

  if (role === "owner") {
    return <Navigate to="/owner/dashboard" replace />;
  }

  return <Navigate to="/tenant/dashboard" replace />;
}

function AuthRoute() {
  const { isLoggedIn, role } = useAuth();

  if (isLoggedIn) {
    if (role === "owner") {
      return <Navigate to="/owner/dashboard" replace />;
    }

    return <Navigate to="/tenant/dashboard" replace />;
  }

  return <Authpage />;
}

function ProtectedRoute({ allowedRole, children }) {
  const { isLoggedIn, role } = useAuth();

  if (!isLoggedIn) {
    return <Navigate to="/auth" replace />;
  }

  if (allowedRole && role !== allowedRole) {
    return <RedirectByRole />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<RedirectByRole />} />
      <Route path="/auth" element={<AuthRoute />} />
      <Route
        path="/tenant/dashboard"
        element={(
          <ProtectedRoute allowedRole="tenant">
            <TenantDashboard />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/dashboard"
        element={(
          <ProtectedRoute allowedRole="owner">
            <OwnerDashboard />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/properties"
        element={(
          <ProtectedRoute allowedRole="owner">
            <PropertiesList />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/properties/new"
        element={(
          <ProtectedRoute allowedRole="owner">
            <AddProperty />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/properties/:propertyId/edit"
        element={(
          <ProtectedRoute allowedRole="owner">
            <EditProperty />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/properties/:propertyId"
        element={(
          <ProtectedRoute allowedRole="owner">
            <PropertyDetail />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/leases"
        element={(
          <ProtectedRoute allowedRole="owner">
            <LeaseManagement />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/payments"
        element={(
          <ProtectedRoute allowedRole="owner">
            <OwnerPayments />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/maintenance"
        element={(
          <ProtectedRoute allowedRole="owner">
            <OwnerMaintenance />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/owner/documents"
        element={(
          <ProtectedRoute allowedRole="owner">
            <OwnerDocuments />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/tenant/search"
        element={(
          <ProtectedRoute allowedRole="tenant">
            <TenantSearch />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/tenant/search/:propertyId"
        element={(
          <ProtectedRoute allowedRole="tenant">
            <TenantPropertyDetail />
          </ProtectedRoute>
        )}
      />
      <Route
        path="/tenant/search/:propertyId/apply"
        element={(
          <ProtectedRoute allowedRole="tenant">
            <TenantApply />
          </ProtectedRoute>
        )}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Suspense fallback={<div />}>
        <AppRoutes />
      </Suspense>
    </AuthProvider>
  );
}