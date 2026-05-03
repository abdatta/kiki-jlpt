import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConsumerApp } from './consumer/ConsumerApp.tsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConsumerApp />
  </React.StrictMode>
);
