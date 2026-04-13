import AdminPage from './pages/AdminPage';
import './App.css';

export default function App() {
  return (
    <div className="app">
      <header className="app-header">
        <img src="/logo-small.png" alt="openclaw-worker" className="header-logo" />
        <h1>openclaw admin</h1>
      </header>
      <main className="app-main">
        <AdminPage />
      </main>
    </div>
  );
}
