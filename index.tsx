import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Service Worker Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // Determine the base path from Vite's env or default to root
    const baseUrl = ((import.meta as any).env && (import.meta as any).env.BASE_URL) || '/';
    // Construct the path to sw.js. It resides in public/, so it will be at the root of the build.
    const swUrl = `${baseUrl}sw.js`.replace('//', '/');

    navigator.serviceWorker.register(swUrl)
      .then((registration) => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      })
      .catch((err) => {
        console.log('ServiceWorker registration failed: ', err);
      });
  });
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);