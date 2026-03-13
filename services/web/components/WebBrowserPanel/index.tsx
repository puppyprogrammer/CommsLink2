'use client';

import React, { useState, useRef } from 'react';
import { IconButton, Typography, ToggleButtonGroup, ToggleButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import SearchIcon from '@mui/icons-material/Search';
import LanguageIcon from '@mui/icons-material/Language';
import WebIcon from '@mui/icons-material/Web';
import ArticleIcon from '@mui/icons-material/Article';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import RefreshIcon from '@mui/icons-material/Refresh';
import styles from './WebBrowserPanel.module.scss';

import type { Socket } from 'socket.io-client';

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

type PageLink = {
  index: number;
  text: string;
  href: string;
};

export type WebPanelData =
  | { type: 'search'; query: string; results: SearchResult[] }
  | { type: 'page'; url: string; title: string; text: string; links: PageLink[] }
  | { type: 'screenshot'; url: string; imageBase64: string }
  | { type: 'browser'; url: string; title: string; imageBase64: string }
  | { type: 'browser_closed' };

type Props = {
  data: WebPanelData | null;
  onClose: () => void;
  socket?: Socket | null;
};

const WebBrowserPanel: React.FC<Props> = ({ data, onClose, socket }) => {
  const [viewMode, setViewMode] = useState<'site' | 'text' | 'screenshot'>('text');
  const [iframeFailed, setIframeFailed] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const urlInputRef = useRef<HTMLInputElement>(null);

  const handleUrlSubmit = () => {
    const url = urlInput.trim();
    if (!url || !socket) return;
    const fullUrl = url.startsWith('http') ? url : `https://${url}`;
    socket.emit('web_navigate', { url: fullUrl });
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleUrlSubmit();
    }
  };

  const isBrowser = data?.type === 'browser';
  const isBrowserClosed = data?.type === 'browser_closed';

  // Update URL bar when browser navigates
  React.useEffect(() => {
    if (data?.type === 'browser' && data.url) {
      setUrlInput(data.url);
    }
  }, [data]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        {isBrowser ? (
          <>
            <div className={styles.sessionIndicator} />
            <IconButton
              size="small"
              onClick={() => socket?.emit('web_navigate', { url: 'BACK' })}
              sx={{ p: '3px' }}
              title="Back"
              disabled={!socket}
            >
              <ArrowBackIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => socket?.emit('web_navigate', { url: 'FORWARD' })}
              sx={{ p: '3px' }}
              title="Forward"
              disabled={!socket}
            >
              <ArrowForwardIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => socket?.emit('web_navigate', { url: data.url })}
              sx={{ p: '3px' }}
              title="Refresh"
              disabled={!socket}
            >
              <RefreshIcon sx={{ fontSize: 16 }} />
            </IconButton>
            <input
              ref={urlInputRef}
              type="text"
              className={styles.urlInput}
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              onKeyDown={handleUrlKeyDown}
              placeholder="Enter URL..."
            />
          </>
        ) : data?.type === 'search' ? (
          <>
            <SearchIcon sx={{ fontSize: 18, color: 'primary.main', flexShrink: 0 }} />
            <span className={styles.urlBar}>Search: {data.query}</span>
          </>
        ) : data?.type === 'screenshot' ? (
          <>
            <PhotoCameraIcon sx={{ fontSize: 18, color: 'warning.main', flexShrink: 0 }} />
            <span className={styles.urlBar}>{data.url}</span>
          </>
        ) : data?.type === 'page' ? (
          <>
            <LanguageIcon sx={{ fontSize: 18, color: 'success.main', flexShrink: 0 }} />
            <span className={styles.urlBar}>{data.url}</span>
            <ToggleButtonGroup
              value={viewMode}
              exclusive
              onChange={(_, v) => v && setViewMode(v)}
              size="small"
              sx={{ flexShrink: 0 }}
            >
              <ToggleButton value="site" sx={{ p: '2px 6px' }} title="Site View">
                <WebIcon sx={{ fontSize: 14 }} />
              </ToggleButton>
              <ToggleButton value="text" sx={{ p: '2px 6px' }} title="Text View">
                <ArticleIcon sx={{ fontSize: 14 }} />
              </ToggleButton>
            </ToggleButtonGroup>
          </>
        ) : (
          <>
            <LanguageIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
            <span className={styles.urlBar}>Web Browser</span>
          </>
        )}
        {isBrowser && socket && (
          <IconButton
            size="small"
            onClick={() => {
              socket.emit('web_close_session');
              onClose();
            }}
            sx={{ flexShrink: 0 }}
            title="Close browser session"
          >
            <CloseIcon sx={{ fontSize: 16, color: 'error.main' }} />
          </IconButton>
        )}
        <IconButton size="small" onClick={onClose} sx={{ flexShrink: 0 }}>
          <CloseIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </div>

      <div
        className={
          isBrowser
            ? styles.contentFlush
            : data?.type === 'page' && viewMode === 'site'
              ? styles.contentFlush
              : styles.content
        }
      >
        {!data && (
          <div className={styles.empty}>
            The AI can browse the web here. Search results and page content will appear in this panel.
          </div>
        )}

        {isBrowserClosed && <div className={styles.empty}>Browser session closed.</div>}

        {isBrowser && (
          <div className={styles.browserView}>
            {data.title && <div className={styles.browserTitle}>{data.title}</div>}
            {data.imageBase64 ? (
              <img
                src={`data:image/jpeg;base64,${data.imageBase64}`}
                alt={`Browser: ${data.title}`}
                className={styles.browserScreenshot}
              />
            ) : (
              <div className={styles.empty}>Loading...</div>
            )}
          </div>
        )}

        {data?.type === 'search' && (
          <>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 1 }}>
              {data.results.length} result{data.results.length !== 1 ? 's' : ''} for &quot;{data.query}&quot;
            </Typography>
            {data.results.map((r, i) => (
              <a key={i} href={r.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>
                <div className={styles.searchResult}>
                  <div className={styles.resultTitle}>{r.title}</div>
                  <div className={styles.resultUrl}>{r.url}</div>
                  <div className={styles.resultSnippet}>{r.snippet}</div>
                </div>
              </a>
            ))}
          </>
        )}

        {data?.type === 'page' && viewMode === 'site' && (
          <>
            <iframe
              src={data.url}
              className={styles.iframe}
              sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
              referrerPolicy="no-referrer"
              title={data.title}
              onError={() => setIframeFailed(true)}
              onLoad={(e) => {
                try {
                  const frame = e.target as HTMLIFrameElement;
                  const doc = frame.contentDocument;
                  if (!doc) setIframeFailed(true);
                } catch {
                  setIframeFailed(true);
                }
              }}
            />
            {iframeFailed && (
              <div
                className={styles.empty}
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                This site blocked iframe embedding. Switch to Text View.
              </div>
            )}
          </>
        )}

        {data?.type === 'page' && viewMode === 'text' && (
          <>
            <div className={styles.pageTitle}>{data.title}</div>
            <div className={styles.pageText}>{data.text}</div>
            {data.links.length > 0 && (
              <div className={styles.linkList}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                  Links ({data.links.length})
                </Typography>
                {data.links.map((link) => (
                  <a
                    key={link.index}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.linkItem}
                  >
                    [{link.index}] {link.text}
                  </a>
                ))}
              </div>
            )}
          </>
        )}

        {data?.type === 'screenshot' && (
          <div className={styles.screenshotContainer}>
            <img
              src={`data:image/jpeg;base64,${data.imageBase64}`}
              alt={`Screenshot of ${data.url}`}
              className={styles.screenshotImage}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default WebBrowserPanel;
