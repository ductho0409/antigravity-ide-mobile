import { useRef, useEffect, useState } from 'preact/hooks';

// ─── Types ──────────────────────────────────────────────────────────
interface CodeEditorProps {
    value: string;
    lang: string;
    readOnly?: boolean;
    onChange?: (value: string) => void;
}

// ─── Language loader ────────────────────────────────────────────────
type Extension = import('@codemirror/state').Extension;

async function loadLangExtension(lang: string): Promise<Extension> {
    switch (lang) {
        case 'javascript': {
            const m = await import('@codemirror/lang-javascript');
            return m.javascript();
        }
        case 'typescript': {
            const m = await import('@codemirror/lang-javascript');
            return m.javascript({ typescript: true });
        }
        case 'jsx': {
            const m = await import('@codemirror/lang-javascript');
            return m.javascript({ jsx: true });
        }
        case 'tsx': {
            const m = await import('@codemirror/lang-javascript');
            return m.javascript({ jsx: true, typescript: true });
        }
        case 'css': {
            const m = await import('@codemirror/lang-css');
            return m.css();
        }
        case 'html': {
            const m = await import('@codemirror/lang-html');
            return m.html();
        }
        case 'python': {
            const m = await import('@codemirror/lang-python');
            return m.python();
        }
        case 'json': {
            const m = await import('@codemirror/lang-json');
            return m.json();
        }
        case 'markdown': {
            const m = await import('@codemirror/lang-markdown');
            return m.markdown();
        }
        case 'c':
        case 'cpp': {
            const m = await import('@codemirror/lang-cpp');
            return m.cpp();
        }
        case 'java': {
            const m = await import('@codemirror/lang-java');
            return m.java();
        }
        case 'php': {
            const m = await import('@codemirror/lang-php');
            return m.php();
        }
        case 'rust': {
            const m = await import('@codemirror/lang-rust');
            return m.rust();
        }
        case 'csharp': {
            const { StreamLanguage } = await import('@codemirror/language');
            const { csharp } = await import('@codemirror/legacy-modes/mode/clike');
            return StreamLanguage.define(csharp);
        }
        case 'go': {
            const { StreamLanguage } = await import('@codemirror/language');
            const { go } = await import('@codemirror/legacy-modes/mode/go');
            return StreamLanguage.define(go);
        }
        case 'ruby': {
            const { StreamLanguage } = await import('@codemirror/language');
            const { ruby } = await import('@codemirror/legacy-modes/mode/ruby');
            return StreamLanguage.define(ruby);
        }
        case 'swift': {
            const { StreamLanguage } = await import('@codemirror/language');
            const { swift } = await import('@codemirror/legacy-modes/mode/swift');
            return StreamLanguage.define(swift);
        }
        case 'kotlin': {
            const { StreamLanguage } = await import('@codemirror/language');
            const { kotlin } = await import('@codemirror/legacy-modes/mode/clike');
            return StreamLanguage.define(kotlin);
        }
        default:
            return [];
    }
}

// ─── Component ──────────────────────────────────────────────────────
export function CodeEditor({ value, lang, readOnly = false, onChange }: CodeEditorProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<{
        destroy: () => void;
        state: { doc: { toString: () => string; length: number } };
        dispatch: (spec: { changes: { from: number; to: number; insert: string } }) => void;
    } | null>(null);
    const onChangeRef = useRef(onChange);
    const [loading, setLoading] = useState(true);
    onChangeRef.current = onChange;

    useEffect(() => {
        if (!containerRef.current) return;
        let destroyed = false;

        setLoading(true);

        Promise.all([
            import('codemirror'),
            import('@codemirror/state'),
            import('@codemirror/theme-one-dark'),
            loadLangExtension(lang),
        ]).then(([cm, state, theme, langExt]) => {
            if (destroyed || !containerRef.current) return;

            const { EditorView, basicSetup } = cm;
            const { EditorState } = state;
            const { oneDark } = theme;

            const editorTheme = EditorView.theme({
                '&': {
                    position: 'absolute',
                    top: '0',
                    left: '0',
                    right: '0',
                    bottom: '0',
                    fontSize: '13px'
                },
                '.cm-scroller': {
                    fontFamily: "'Fira Code', 'SF Mono', 'Cascadia Code', monospace",
                    lineHeight: '1.6',
                    overflow: 'auto',
                },
                '.cm-gutters': { background: 'transparent', border: 'none' },
            });

            const extensions: Extension[] = [
                basicSetup,
                oneDark,
                editorTheme,
                langExt,
            ];

            if (readOnly) {
                extensions.push(EditorState.readOnly.of(true));
                extensions.push(EditorView.editable.of(false));
            } else {
                extensions.push(EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        onChangeRef.current?.(update.state.doc.toString());
                    }
                }));
            }

            const editorState = EditorState.create({
                doc: value,
                extensions,
            });

            const view = new EditorView({
                state: editorState,
                parent: containerRef.current!,
            });

            viewRef.current = view;
            setLoading(false);
        });

        return () => {
            destroyed = true;
            if (viewRef.current) {
                viewRef.current.destroy();
                viewRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lang, readOnly]);

    // Update editor content when value changes without recreating editor
    useEffect(() => {
        const view = viewRef.current;
        if (!view || !view.state) return;
        const currentContent = view.state.doc.toString();
        if (currentContent !== value) {
            view.dispatch({
                changes: { from: 0, to: view.state.doc.length, insert: value },
            });
        }
    }, [value]);

    return (
        <div ref={containerRef} className="flex-1 min-h-0 overflow-hidden relative">
            {loading && (
                <div className="absolute inset-0 flex items-center justify-center text-[var(--text-muted)] text-sm">
                    <div className="spinner mr-2" />
                    Loading...
                </div>
            )}
        </div>
    );
}
