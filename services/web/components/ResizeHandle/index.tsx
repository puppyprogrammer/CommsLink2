'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import styles from './ResizeHandle.module.scss';

type Props = {
  onResize: (deltaX: number) => void;
};

const ResizeHandle: React.FC<Props> = ({ onResize }) => {
  const dragging = useRef(false);
  const lastX = useRef(0);

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = lastX.current - e.clientX;
      lastX.current = e.clientX;
      onResize(delta);
    },
    [onResize],
  );

  const handleMouseUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return <div className={styles.handle} onMouseDown={handleMouseDown} />;
};

export default ResizeHandle;
