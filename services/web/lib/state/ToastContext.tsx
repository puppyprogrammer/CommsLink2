'use client';

import React, { createContext, useContext, useState, useCallback } from 'react';
import { Snackbar, Alert } from '@mui/material';

type Severity = 'error' | 'warning' | 'info' | 'success';

type Toast = {
  message: string;
  severity: Severity;
  key: number;
};

type ToastContextValue = {
  toast: (message: string, severity?: Severity) => void;
};

const ToastContext = createContext<ToastContextValue>({ toast: () => {} });

export const useToast = () => useContext(ToastContext);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [current, setCurrent] = useState<Toast | null>(null);

  const toast = useCallback((message: string, severity: Severity = 'error') => {
    setCurrent({ message, severity, key: Date.now() });
  }, []);

  const handleClose = (_?: React.SyntheticEvent | Event, reason?: string) => {
    if (reason === 'clickaway') return;
    setCurrent(null);
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <Snackbar
        open={!!current}
        autoHideDuration={5000}
        onClose={handleClose}
        key={current?.key}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={handleClose} severity={current?.severity || 'error'} variant="filled" sx={{ width: '100%' }}>
          {current?.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  );
};
