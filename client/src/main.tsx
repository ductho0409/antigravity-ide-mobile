/**
 * Mobile Frontend — Entry Point
 */
import { render } from 'preact';
import { App } from './app';
import { registerSW } from 'virtual:pwa-register';
import './styles/index.css';

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  registerSW({ immediate: true });
}

render(<App />, document.getElementById('app')!);
