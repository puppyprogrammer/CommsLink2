'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { createEditor, Descendant, Editor, Element as SlateElement, Transforms, Range, Text, Node } from 'slate';
import { Slate, Editable, withReact, ReactEditor, RenderElementProps, RenderLeafProps } from 'slate-react';
import { withHistory } from 'slate-history';
import isHotkey from 'is-hotkey';
import { Box, IconButton, Tooltip } from '@mui/material';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import CodeIcon from '@mui/icons-material/Code';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import SendIcon from '@mui/icons-material/Send';
import styles from './ChatInput.module.scss';

// ── Types ──────────────────────────────────────────────────────────

type CustomText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  code?: boolean;
};

type ParagraphElement = { type: 'paragraph'; children: CustomText[] };
type CodeBlockElement = { type: 'code-block'; children: CustomText[] };
type CustomElement = ParagraphElement | CodeBlockElement;

declare module 'slate' {
  interface CustomTypes {
    Editor: ReturnType<typeof withReact> & ReturnType<typeof withHistory>;
    Element: CustomElement;
    Text: CustomText;
  }
}

type MarkFormat = 'bold' | 'italic' | 'strikethrough' | 'code';

type Props = {
  onSend: (text: string) => void;
  onPaste?: (e: React.ClipboardEvent) => void;
  onImageSelect?: (file: File) => void;
  disabled?: boolean;
  placeholder?: string;
  actionButtons?: React.ReactNode;
  compact?: boolean;
};

// ── Hotkeys ──────────────────────────────────────────────────────

const HOTKEYS: Record<string, MarkFormat> = {
  'mod+b': 'bold',
  'mod+i': 'italic',
  'mod+shift+x': 'strikethrough',
  'mod+e': 'code',
};

// ── Mark helpers ──────────────────────────────────────────────────

const isMarkActive = (editor: Editor, format: MarkFormat): boolean => {
  const marks = Editor.marks(editor);
  return marks ? marks[format] === true : false;
};

const toggleMark = (editor: Editor, format: MarkFormat) => {
  const isActive = isMarkActive(editor, format);
  if (isActive) {
    Editor.removeMark(editor, format);
  } else {
    Editor.addMark(editor, format, true);
  }
};

// ── Markdown shortcuts ────────────────────────────────────────────

const withMarkdownShortcuts = (editor: Editor) => {
  const { insertText } = editor;

  editor.insertText = (text: string) => {
    const { selection } = editor;

    if (text === '`' && selection && Range.isCollapsed(selection)) {
      const [node] = Editor.node(editor, selection.anchor.path);
      if (Text.isText(node) && node.text === '``') {
        const path = selection.anchor.path.slice(0, -1);
        Transforms.removeNodes(editor, { at: path });
        Transforms.insertNodes(editor, { type: 'code-block', children: [{ text: '' }] }, { at: path });
        Transforms.select(editor, Editor.end(editor, path));
        return;
      }
    }

    insertText(text);

    if (selection && Range.isCollapsed(selection)) {
      applyInlineMarkdown(editor);
    }
  };

  return editor;
};

const applyInlineMarkdown = (editor: Editor) => {
  const { selection } = editor;
  if (!selection || !Range.isCollapsed(selection)) return;

  const [node, path] = Editor.node(editor, selection.anchor.path);
  if (!Text.isText(node)) return;

  const text = node.text;
  const offset = selection.anchor.offset;
  const before = text.slice(0, offset);

  const patterns: { re: RegExp; mark: MarkFormat }[] = [
    { re: /\*\*(.+?)\*\*$/, mark: 'bold' },
    { re: /(?<!\*)\*([^*]+?)\*$/, mark: 'italic' },
    { re: /~~(.+?)~~$/, mark: 'strikethrough' },
    { re: /`([^`]+?)`$/, mark: 'code' },
  ];

  for (const { re, mark } of patterns) {
    const match = before.match(re);
    if (match) {
      const fullMatch = match[0];
      const content = match[1];
      const start = offset - fullMatch.length;

      Transforms.delete(editor, {
        at: { anchor: { path, offset: start }, focus: { path, offset } },
      });
      Transforms.insertNodes(editor, { text: content, [mark]: true }, { at: { path, offset: start } });

      const newOffset = start + content.length;
      Transforms.select(editor, { path, offset: newOffset });
      Editor.removeMark(editor, mark);
      break;
    }
  }
};

// ── Serialize Slate to markdown ───────────────────────────────────

const serializeToMarkdown = (nodes: Descendant[]): string => {
  return nodes
    .map((node) => {
      if (SlateElement.isElement(node)) {
        if (node.type === 'code-block') {
          const text = node.children.map((c) => ('text' in c ? c.text : '')).join('');
          return '```\n' + text + '\n```';
        }
        return node.children.map(serializeLeaf).join('');
      }
      return serializeLeaf(node as CustomText);
    })
    .join('\n');
};

const serializeLeaf = (node: CustomText): string => {
  let text = node.text;
  if (!text) return '';
  if (node.code) text = '`' + text + '`';
  if (node.bold) text = '**' + text + '**';
  if (node.italic) text = '*' + text + '*';
  if (node.strikethrough) text = '~~' + text + '~~';
  return text;
};

// ── Initial value ─────────────────────────────────────────────────

const INITIAL_VALUE: Descendant[] = [{ type: 'paragraph', children: [{ text: '' }] }];

const resetEditor = (editor: Editor) => {
  Transforms.delete(editor, {
    at: { anchor: Editor.start(editor, []), focus: Editor.end(editor, []) },
  });
  const children = [...editor.children];
  for (let i = children.length - 1; i > 0; i--) {
    Transforms.removeNodes(editor, { at: [i] });
  }
  if (editor.children.length > 0) {
    const first = editor.children[0];
    if (SlateElement.isElement(first) && first.type !== 'paragraph') {
      Transforms.setNodes(editor, { type: 'paragraph' }, { at: [0] });
    }
  }
};

// ── Component ─────────────────────────────────────────────────────

const ChatInput: React.FC<Props> = ({ onSend, onPaste, onImageSelect, disabled, placeholder, actionButtons }) => {
  const editor = useMemo(() => withMarkdownShortcuts(withHistory(withReact(createEditor()))), []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState<Descendant[]>(INITIAL_VALUE);

  const handleSend = useCallback(() => {
    const text = serializeToMarkdown(editor.children).trim();
    if (!text) return;
    onSend(text);
    resetEditor(editor);
    setValue([...editor.children]);
    ReactEditor.focus(editor);
  }, [editor, onSend]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      for (const hotkey in HOTKEYS) {
        if (isHotkey(hotkey, event as unknown as KeyboardEvent)) {
          event.preventDefault();
          toggleMark(editor, HOTKEYS[hotkey]);
          return;
        }
      }

      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        handleSend();
      }
    },
    [editor, handleSend],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onImageSelect(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onImageSelect],
  );

  const renderElement = useCallback((props: RenderElementProps) => {
    switch (props.element.type) {
      case 'code-block':
        return (
          <pre className={styles.codeBlock} {...props.attributes}>
            <code>{props.children}</code>
          </pre>
        );
      default:
        return (
          <p className={styles.paragraph} {...props.attributes}>
            {props.children}
          </p>
        );
    }
  }, []);

  const renderLeaf = useCallback((props: RenderLeafProps) => {
    let { children } = props;
    const leaf = props.leaf as CustomText;
    if (leaf.bold) children = <strong>{children}</strong>;
    if (leaf.italic) children = <em>{children}</em>;
    if (leaf.strikethrough) children = <s>{children}</s>;
    if (leaf.code) children = <code className={styles.inlineCode}>{children}</code>;
    return <span {...props.attributes}>{children}</span>;
  }, []);

  return (
    <Box className={styles.root}>
      <Box className={styles.toolbar}>
        <Box className={styles.formatButtons}>
          <Tooltip title="Bold (Ctrl+B)" placement="top" arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleMark(editor, 'bold');
              }}
              className={styles.toolbarBtn}
            >
              <FormatBoldIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Italic (Ctrl+I)" placement="top" arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleMark(editor, 'italic');
              }}
              className={styles.toolbarBtn}
            >
              <FormatItalicIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Strikethrough (Ctrl+Shift+X)" placement="top" arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleMark(editor, 'strikethrough');
              }}
              className={styles.toolbarBtn}
            >
              <StrikethroughSIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Code (Ctrl+E)" placement="top" arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => {
                e.preventDefault();
                toggleMark(editor, 'code');
              }}
              className={styles.toolbarBtn}
            >
              <CodeIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Attach Image" placement="top" arrow>
            <IconButton
              size="small"
              onMouseDown={(e) => {
                e.preventDefault();
                fileInputRef.current?.click();
              }}
              className={styles.toolbarBtn}
            >
              <AttachFileIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileSelect}
          />
        </Box>
        <Box className={styles.actionButtons}>
          {actionButtons}
          <IconButton
            size="small"
            color="primary"
            onMouseDown={(e) => {
              e.preventDefault();
              handleSend();
            }}
          >
            <SendIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </Box>
      <Slate editor={editor} initialValue={INITIAL_VALUE} onChange={setValue}>
        <Editable
          className={styles.editable}
          renderElement={renderElement}
          renderLeaf={renderLeaf}
          placeholder={placeholder || 'Type a message...'}
          onKeyDown={handleKeyDown}
          onPaste={onPaste as unknown as React.ClipboardEventHandler<HTMLDivElement>}
          readOnly={disabled}
          spellCheck
          autoFocus
        />
      </Slate>
    </Box>
  );
};

export default ChatInput;
