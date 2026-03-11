'use client';

// React modules
import { createTheme } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface TypographyVariants {
    title: React.CSSProperties;
    detailText: React.CSSProperties;
    sm: React.CSSProperties;
  }
  interface TypographyVariantsOptions {
    title?: React.CSSProperties;
    detailText?: React.CSSProperties;
    sm?: React.CSSProperties;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    title: true;
    detailText: true;
    sm: true;
  }
}

const LightTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#569cd6',
      dark: '#4080bf',
      light: '#9cdcfe',
    },
    secondary: {
      main: '#858585',
    },
    success: {
      main: '#6a9955',
    },
    error: {
      main: '#f44747',
    },
    background: {
      default: '#1e1e1e',
      paper: '#252526',
    },
    text: {
      primary: '#cccccc',
      secondary: '#858585',
    },
    divider: '#333333',
  },
  typography: {
    fontFamily: '"Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontSize: 16,
    htmlFontSize: 16,
    body1: {
      fontSize: '1rem',
    },
    body2: {
      fontSize: '0.9375rem',
    },
    title: {
      fontSize: '1.25rem',
      fontWeight: 600,
    },
    detailText: {
      fontSize: '0.875rem',
      color: '#858585',
    },
    sm: {
      fontSize: '0.8125rem',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          borderRadius: 2,
        },
        contained: {
          backgroundColor: '#007acc',
          '&:hover': {
            backgroundColor: '#005fa3',
          },
        },
        outlined: {
          borderColor: '#858585',
          '&:hover': {
            borderColor: '#cccccc',
            backgroundColor: 'rgba(255,255,255,0.04)',
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: 0,
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 2,
            backgroundColor: '#3c3c3c',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: '#3c3c3c',
            },
            '&:hover .MuiOutlinedInput-notchedOutline': {
              borderColor: '#007acc',
            },
            '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
              borderColor: '#007acc',
            },
          },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 2,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          '&:hover': {
            backgroundColor: '#2a2d2e',
          },
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          backgroundColor: '#181818',
          boxShadow: 'none',
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: '#181818',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: '#252526',
          borderRadius: 0,
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 2,
        },
      },
    },
  },
});

export default LightTheme;
