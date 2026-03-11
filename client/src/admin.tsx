/**
 * Admin entry point — Preact app for /admin route
 */
import { render } from 'preact';
import { AdminApp } from './pages/admin/AdminApp';
import './styles/admin-theme.css';

render(<AdminApp />, document.getElementById('app')!);
