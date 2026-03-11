/**
 * StreamPanel — Live IDE screen streaming via CDP Screencast
 * Supports: tap-to-click, drag-to-select, keyboard input
 */
import { useState, useRef, useCallback, useEffect, useMemo } from 'preact/hooks';
import { useApp } from '../context/AppContext';
import { useTranslation } from '../i18n';
import { Monitor, Keyboard, Maximize2, Minimize2, Copy, ClipboardPaste, Square, Play } from 'lucide-preact';

// Detect iOS (iPhone/iPod) — iPad reports as Mac in modern Safari
const getIsIOS = (): boolean =>
    /iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && !(window as unknown as Record<string, unknown>).MSStream);

// Special keys that need dispatchKeyEvent instead of insertText
const SPECIAL_KEYS: Record<string, { key: string; code: string }> = {
    Enter: { key: 'Enter', code: 'Enter' },
    Backspace: { key: 'Backspace', code: 'Backspace' },
    Delete: { key: 'Delete', code: 'Delete' },
    Tab: { key: 'Tab', code: 'Tab' },
    Escape: { key: 'Escape', code: 'Escape' },
    ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft' },
    ArrowRight: { key: 'ArrowRight', code: 'ArrowRight' },
    ArrowUp: { key: 'ArrowUp', code: 'ArrowUp' },
    ArrowDown: { key: 'ArrowDown', code: 'ArrowDown' },
    Home: { key: 'Home', code: 'Home' },
    End: { key: 'End', code: 'End' },
};

// CDP modifier flags
const MOD_ALT = 1;
const MOD_CTRL = 2;
const MOD_META = 4;
const MOD_SHIFT = 8;

export function StreamPanel() {
    const { wsSendRef, streamFrameRef, streamStartedRef, activePanel, connected } = useApp();
    const { t } = useTranslation();

    const [streaming, setStreaming] = useState(false);
    const [frame, setFrame] = useState<string | null>(null);
    const [landscape, setLandscape] = useState(false);
    const [iosFullscreen, setIosFullscreen] = useState(false);
    const [tapFeedback, setTapFeedback] = useState<{ x: number; y: number } | null>(null);
    const [zoom, setZoom] = useState(1);
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const [fps, setFps] = useState(0);
    const fpsCountRef = useRef(0);
    const [quality, setQuality] = useState<'low' | 'med' | 'high'>(
        () => (localStorage.getItem('streamQuality') as 'low' | 'med' | 'high') || 'med'
    );
    const cssViewportRef = useRef<{ width: number; height: number } | null>(null);
    const imgRef = useRef<HTMLImageElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const streamingRef = useRef(false);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const isDraggingRef = useRef(false);
    const mouseDownRef = useRef(false);
    const lastTapTimeRef = useRef(0);
    const lastTapCoordsRef = useRef<{ x: number; y: number } | null>(null);
    const pinchStartDistRef = useRef(0);
    const pinchStartZoomRef = useRef(1);
    const pinchMidRef = useRef({ x: 0, y: 0 });
    const DOUBLE_TAP_MS = 300;
    const DOUBLE_TAP_DIST = 30;
    const QUALITY_PRESETS = {
        low: { quality: 50, maxWidth: 1440, maxHeight: 900, everyNthFrame: 2 },
        med: { quality: 75, maxWidth: 1920, maxHeight: 1200 },
        high: { quality: 100 }, // no resolution limit
    };

    // ─── Coordinate mapping helper ──────────────────────────────────
    const mapCoords = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const img = imgRef.current;
        if (!img) return null;
        const rect = img.getBoundingClientRect();
        const vp = cssViewportRef.current;
        const targetW = vp ? vp.width : img.naturalWidth;
        const targetH = vp ? vp.height : img.naturalHeight;
        return {
            x: Math.round(((clientX - rect.left) / rect.width) * targetW),
            y: Math.round(((clientY - rect.top) / rect.height) * targetH),
        };
    }, []);

    // ─── Stream lifecycle ───────────────────────────────────────────
    useEffect(() => {
        if (activePanel === 'stream') {
            streamFrameRef.current = (dataUrl: string) => {
                if (streamingRef.current) {
                    fpsCountRef.current++;
                    // Revoke previous Blob URL to prevent memory leak
                    setFrame(prev => {
                        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                        return dataUrl;
                    });
                }
            };
            streamStartedRef.current = (data) => {
                if (data?.cssViewport && data.cssViewport.width > 0) {
                    cssViewportRef.current = data.cssViewport;
                }
            };
            setFrame(null);
            cssViewportRef.current = null;
            setStreaming(true);
            streamingRef.current = true;
            wsSendRef.current({ action: 'start_stream', ...QUALITY_PRESETS[quality] });
        } else if (streamingRef.current) {
            wsSendRef.current({ action: 'stop_stream' });
            setStreaming(false);
            streamingRef.current = false;
            setFrame(prev => {
                if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
                return null;
            });
            inputRef.current?.blur();
        }
        return () => {
            streamFrameRef.current = null;
            streamStartedRef.current = null;
        };
    }, [activePanel, streamFrameRef, streamStartedRef, wsSendRef, quality]);

    // Auto-reconnect: when WS reconnects while on stream panel, restart stream
    const prevConnectedRef = useRef(connected);
    useEffect(() => {
        if (connected && !prevConnectedRef.current && activePanel === 'stream' && streamingRef.current) {
            // WS just reconnected — restart stream
            wsSendRef.current({ action: 'start_stream', ...QUALITY_PRESETS[quality] });
        }
        prevConnectedRef.current = connected;
    }, [connected, activePanel, wsSendRef, quality]);

    const stopStream = useCallback(() => {
        wsSendRef.current({ action: 'stop_stream' });
        setStreaming(false);
        streamingRef.current = false;
        setFrame(null);
    }, [wsSendRef]);

    const startStream = useCallback(() => {
        setFrame(null);
        cssViewportRef.current = null;
        setStreaming(true);
        streamingRef.current = true;
        wsSendRef.current({ action: 'start_stream', ...QUALITY_PRESETS[quality] });
    }, [wsSendRef, quality]);

    const cycleQuality = useCallback(() => {
        setQuality(prev => {
            const next = prev === 'low' ? 'med' : prev === 'med' ? 'high' : 'low';
            localStorage.setItem('streamQuality', next);
            // Hot-swap quality: server restarts screencast on same CDP connection
            if (streamingRef.current) {
                wsSendRef.current({ action: 'start_stream', ...QUALITY_PRESETS[next as 'low' | 'med' | 'high'] });
            }
            return next;
        });
    }, [wsSendRef]);

    // ─── Touch handling: tap=click, swipe=scroll, long-press+drag=select ──
    type GestureMode = 'pending' | 'scroll' | 'select' | 'pinch';
    const gestureModeRef = useRef<GestureMode>('pending');
    const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const touchClientRef = useRef<{ cx: number; cy: number }>({ cx: 0, cy: 0 });
    const LONG_PRESS_MS = 300;

    const handleTouchStart = useCallback((e: TouchEvent) => {
        // Pinch-to-zoom: 2 fingers
        if (e.touches.length === 2) {
            if (longPressTimerRef.current) {
                clearTimeout(longPressTimerRef.current);
                longPressTimerRef.current = null;
            }
            gestureModeRef.current = 'pinch';
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            pinchStartDistRef.current = Math.hypot(dx, dy);
            pinchStartZoomRef.current = zoom;
            pinchMidRef.current = {
                x: (e.touches[0].clientX + e.touches[1].clientX) / 2,
                y: (e.touches[0].clientY + e.touches[1].clientY) / 2,
            };
            e.preventDefault();
            return;
        }
        if (e.touches.length !== 1) return;
        // Blur keyboard input on stream tap — prevent Android from re-showing keyboard
        if (document.activeElement === inputRef.current) {
            inputRef.current?.blur();
        }
        const touch = e.touches[0];
        const coords = mapCoords(touch.clientX, touch.clientY);
        if (!coords) return;

        dragStartRef.current = coords;
        touchClientRef.current = { cx: touch.clientX, cy: touch.clientY };
        gestureModeRef.current = 'pending';
        isDraggingRef.current = false;

        // Start long-press timer → after 300ms switch to select mode
        longPressTimerRef.current = setTimeout(() => {
            gestureModeRef.current = 'select';
            // Send mousePressed to start selection
            if (dragStartRef.current) {
                wsSendRef.current({ action: 'stream_mouse', type: 'mousePressed', ...dragStartRef.current });
            }
        }, LONG_PRESS_MS);

        e.preventDefault();
    }, [wsSendRef, mapCoords, zoom]);

    const handleTouchMove = useCallback((e: TouchEvent) => {
        // Pinch-to-zoom + pan
        if (e.touches.length === 2 && gestureModeRef.current === 'pinch') {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.hypot(dx, dy);
            const scale = (dist / pinchStartDistRef.current) * pinchStartZoomRef.current;
            setZoom(Math.min(Math.max(scale, 1), 4));

            // Pan: track midpoint movement
            const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
            const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
            const midDx = midX - pinchMidRef.current.x;
            const midDy = midY - pinchMidRef.current.y;
            pinchMidRef.current = { x: midX, y: midY };
            setPanOffset(prev => ({ x: prev.x + midDx, y: prev.y + midDy }));

            e.preventDefault();
            return;
        }
        if (e.touches.length !== 1 || !dragStartRef.current) return;
        const touch = e.touches[0];
        const coords = mapCoords(touch.clientX, touch.clientY);
        if (!coords) return;

        const dx = touch.clientX - touchClientRef.current.cx;
        const dy = touch.clientY - touchClientRef.current.cy;

        if (gestureModeRef.current === 'pending') {
            // If moved before long-press timer → it's a scroll
            if (Math.abs(dx) > 5 || Math.abs(dy) > 5) {
                if (longPressTimerRef.current) {
                    clearTimeout(longPressTimerRef.current);
                    longPressTimerRef.current = null;
                }
                gestureModeRef.current = 'scroll';
            }
        }

        if (gestureModeRef.current === 'scroll') {
            const moveDx = touch.clientX - touchClientRef.current.cx;
            const moveDy = touch.clientY - touchClientRef.current.cy;
            touchClientRef.current = { cx: touch.clientX, cy: touch.clientY };

            if (zoom > 1) {
                // Zoomed in → pan the view
                setPanOffset(prev => ({ x: prev.x + moveDx, y: prev.y + moveDy }));
            } else {
                // Normal → scroll IDE
                wsSendRef.current({
                    action: 'stream_scroll',
                    ...dragStartRef.current,
                    deltaX: Math.round(-moveDx * 2),
                    deltaY: Math.round(-moveDy * 2),
                });
            }
        } else if (gestureModeRef.current === 'select') {
            // Select: send mouseMoved for text selection
            isDraggingRef.current = true;
            wsSendRef.current({ action: 'stream_mouse', type: 'mouseMoved', dragging: true, ...coords });
        }
        e.preventDefault();
    }, [wsSendRef, mapCoords]);

    const handleTouchEnd = useCallback((e: TouchEvent) => {
        // Clear long-press timer
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }

        if (!dragStartRef.current) return;
        const touch = e.changedTouches[0];
        const coords = mapCoords(touch.clientX, touch.clientY);
        if (!coords) return;

        if (gestureModeRef.current === 'pending') {
            // Check for double-tap
            const now = Date.now();
            const last = lastTapCoordsRef.current;
            const timeDiff = now - lastTapTimeRef.current;
            const dist = last ? Math.hypot(dragStartRef.current.x - last.x, dragStartRef.current.y - last.y) : Infinity;

            if (timeDiff < DOUBLE_TAP_MS && dist < DOUBLE_TAP_DIST) {
                // Double-tap → double-click
                wsSendRef.current({ action: 'stream_click', ...dragStartRef.current, clickCount: 2 });
                lastTapTimeRef.current = 0; // reset
                lastTapCoordsRef.current = null;
            } else {
                // Single tap → click
                wsSendRef.current({ action: 'stream_click', ...dragStartRef.current });
                lastTapTimeRef.current = now;
                lastTapCoordsRef.current = { ...dragStartRef.current };
            }

            // Show tap feedback dot — relative to container (position:relative parent)
            const touch = e.changedTouches[0];
            const containerRect = imgRef.current?.parentElement?.getBoundingClientRect();
            if (containerRect) {
                setTapFeedback({ x: touch.clientX - containerRect.left, y: touch.clientY - containerRect.top });
                setTimeout(() => setTapFeedback(null), 400);
            }
        } else if (gestureModeRef.current === 'select') {
            // End selection
            wsSendRef.current({ action: 'stream_mouse', type: 'mouseReleased', ...coords });
        }
        // scroll mode: nothing to do on end

        dragStartRef.current = null;
        isDraggingRef.current = false;
        gestureModeRef.current = 'pending';
        e.preventDefault();
    }, [wsSendRef, mapCoords]);

    // ─── Mouse handling for desktop (click + drag) ──────────────────
    const handleMouseDown = useCallback((e: MouseEvent) => {
        if (e.button !== 0) return; // left button only
        const coords = mapCoords(e.clientX, e.clientY);
        if (!coords) return;
        dragStartRef.current = coords;
        isDraggingRef.current = false;
        mouseDownRef.current = true;
        wsSendRef.current({ action: 'stream_mouse', type: 'mousePressed', ...coords });
        e.preventDefault();
    }, [wsSendRef, mapCoords]);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!mouseDownRef.current || !dragStartRef.current) return;
        const coords = mapCoords(e.clientX, e.clientY);
        if (!coords) return;
        const dx = Math.abs(coords.x - dragStartRef.current.x);
        const dy = Math.abs(coords.y - dragStartRef.current.y);
        if (dx > 5 || dy > 5) isDraggingRef.current = true;
        if (isDraggingRef.current) {
            wsSendRef.current({ action: 'stream_mouse', type: 'mouseMoved', dragging: true, ...coords });
        }
        e.preventDefault();
    }, [wsSendRef, mapCoords]);

    const handleMouseUp = useCallback((e: MouseEvent) => {
        if (!mouseDownRef.current) return;
        const coords = mapCoords(e.clientX, e.clientY);
        if (!coords) return;
        wsSendRef.current({ action: 'stream_mouse', type: 'mouseReleased', ...coords });
        mouseDownRef.current = false;
        dragStartRef.current = null;
        isDraggingRef.current = false;
        e.preventDefault();
    }, [wsSendRef, mapCoords]);

    // Desktop right-click
    const handleContextMenu = useCallback((e: MouseEvent) => {
        e.preventDefault();
        const coords = mapCoords(e.clientX, e.clientY);
        if (!coords) return;
        wsSendRef.current({ action: 'stream_click', ...coords, button: 'right' });
    }, [wsSendRef, mapCoords]);

    // Desktop scroll wheel
    const handleWheel = useCallback((e: WheelEvent) => {
        const coords = mapCoords(e.clientX, e.clientY);
        if (!coords) return;
        wsSendRef.current({
            action: 'stream_scroll',
            ...coords,
            deltaX: Math.round(e.deltaX),
            deltaY: Math.round(e.deltaY),
        });
        e.preventDefault();
    }, [connected, activePanel, wsSendRef, quality]);

    // ─── FPS counter ────────────────────────────────────────────────
    useEffect(() => {
        if (!streaming) { setFps(0); return; }
        const interval = setInterval(() => {
            setFps(fpsCountRef.current);
            fpsCountRef.current = 0;
        }, 1000);
        return () => clearInterval(interval);
    }, [streaming]);

    // ─── Clipboard ──────────────────────────────────────────────────
    const handlePaste = useCallback(async () => {
        try {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            // Paste into IDE via CDP: write to clipboard context then Ctrl+V
            wsSendRef.current({ action: 'stream_paste', text });
        } catch {
            // Clipboard permission denied — fallback prompt
            const text = prompt(t('mobile.stream.pasteText'));
            if (text) wsSendRef.current({ action: 'stream_paste', text });
        }
    }, [wsSendRef]);

    const handleCopy = useCallback(() => {
        // Send Ctrl+C to IDE, then read clipboard result
        wsSendRef.current({ action: 'stream_copy' });
    }, [wsSendRef]);

    // keydown: handles special keys + modifier combos (works on desktop + iOS)
    const handleKeyDown = useCallback((e: KeyboardEvent) => {
        // Android IME sends 'Unidentified' or 'Process' for regular chars — skip
        if (e.key === 'Unidentified' || e.key === 'Process') return;

        const special = SPECIAL_KEYS[e.key];
        // Build modifier flags
        let modifiers = 0;
        if (e.altKey) modifiers |= MOD_ALT;
        if (e.ctrlKey) modifiers |= MOD_CTRL;
        if (e.metaKey) modifiers |= MOD_META;
        if (e.shiftKey) modifiers |= MOD_SHIFT;

        if (special) {
            // Special key (Enter, Backspace, arrows, etc.)
            e.preventDefault();
            wsSendRef.current({
                action: 'stream_key',
                key: special.key,
                code: special.code,
                modifiers: modifiers || undefined,
            });
        } else if (e.key.length === 1 && (e.ctrlKey || e.metaKey)) {
            // Modifier combos: Ctrl+C, Cmd+Z, etc.
            e.preventDefault();
            wsSendRef.current({
                action: 'stream_key',
                key: e.key,
                code: e.code,
                modifiers,
            });
        } else if (e.key.length === 1) {
            // Regular char on desktop/iOS — send via insertText
            e.preventDefault();
            wsSendRef.current({ action: 'stream_key', text: e.key });
            // Clear the input to prevent text buildup
            if (inputRef.current) inputRef.current.value = '';
        }
    }, [wsSendRef]);

    // input event: captures text from Android IME (keydown fires 'Unidentified')
    const handleInput = useCallback((e: Event) => {
        const input = e.target as HTMLInputElement;
        const text = input.value;
        if (text) {
            wsSendRef.current({ action: 'stream_key', text });
            // Clear input so it doesn't accumulate
            input.value = '';
        }
    }, [wsSendRef]);

    const toggleKeyboard = useCallback(() => {
        const el = inputRef.current;
        if (!el) return;
        // If input already focused, blur to dismiss keyboard
        if (document.activeElement === el) {
            el.blur();
        } else {
            el.focus();
        }
    }, []);

    // ─── Landscape: Fullscreen + Orientation Lock ──────────────────
    // iOS iPhone: CSS simulated fullscreen (native API not supported)
    // Android/Desktop/iPad: native Fullscreen API
    const panelRef = useRef<HTMLDivElement>(null);
    const isIOS = useMemo(() => getIsIOS(), []);

    const toggleLandscape = useCallback(async () => {
        if (!landscape) {
            if (isIOS) {
                // iOS: CSS simulated fullscreen (requestFullscreen not supported on iPhone)
                setIosFullscreen(true);
                setLandscape(true);
                // Scroll to top to help hide Safari toolbar
                window.scrollTo(0, 0);
            } else {
                // Android/Desktop/iPad: native Fullscreen API
                try {
                    const el = panelRef.current ?? document.documentElement;
                    if (el.requestFullscreen) {
                        await el.requestFullscreen();
                    } else if ((el as unknown as Record<string, () => Promise<void>>).webkitRequestFullscreen) {
                        await (el as unknown as Record<string, () => Promise<void>>).webkitRequestFullscreen();
                    }
                    // Lock orientation after fullscreen
                    try {
                        await (screen.orientation as unknown as { lock: (o: string) => Promise<void> }).lock('landscape-primary');
                    } catch { /* orientation lock not supported */ }
                    setLandscape(true);
                } catch {
                    // Fullscreen denied — fallback to CSS simulation
                    setIosFullscreen(true);
                    setLandscape(true);
                }
            }
        } else {
            // Exit landscape / fullscreen
            if (isIOS || iosFullscreen) {
                setIosFullscreen(false);
                setLandscape(false);
            } else {
                try {
                    screen.orientation.unlock();
                } catch { /* ignore */ }
                try {
                    if (document.fullscreenElement) {
                        await document.exitFullscreen();
                    } else if ((document as unknown as Record<string, () => Promise<void>>).webkitExitFullscreen) {
                        await (document as unknown as Record<string, () => Promise<void>>).webkitExitFullscreen();
                    }
                } catch { /* ignore */ }
                setLandscape(false);
            }
        }
    }, [landscape, isIOS, iosFullscreen]);

    // Listen for fullscreen exit (e.g. user swipes down) → sync state
    useEffect(() => {
        const handler = () => {
            if (!document.fullscreenElement && landscape && !iosFullscreen) {
                try { screen.orientation.unlock(); } catch { /* noop */ }
                setLandscape(false);
            }
        };
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, [landscape, iosFullscreen]);

    // ─── Render ─────────────────────────────────────────────────────
    // Shared class for toolbar icon buttons
    const toolBtnCls = 'bg-transparent text-[var(--text-muted)] border border-[var(--border-color)] rounded-md px-2 py-1 cursor-pointer flex items-center';

    return (
        <div
            ref={panelRef}
            className={`flex-1 min-h-0 flex flex-col bg-[var(--bg-primary)] ${
                iosFullscreen ? 'fixed inset-0 z-[9999] h-[100dvh] w-screen' : ''
            }`}
        >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--border-color)] bg-[var(--bg-secondary)] shrink-0">
                <span className="font-semibold text-[15px] flex items-center gap-1.5">
                    <Monitor size={16} />
                    <span className="hidden sm:inline">{t('mobile.stream.ideStream')}</span>
                </span>
                <div className="flex items-center gap-1.5">
                    {streaming && (
                        <>
                            {/* Keyboard toggle */}
                            <button onClick={toggleKeyboard} title={t('mobile.stream.toggleKeyboard')} className={toolBtnCls}>
                                <Keyboard size={14} />
                            </button>
                            {/* Fullscreen toggle */}
                            <button
                                onClick={toggleLandscape}
                                title={landscape ? 'Exit fullscreen' : 'Fullscreen'}
                                className={`rounded-md px-2 py-1 cursor-pointer flex items-center border ${landscape
                                    ? 'bg-[rgba(56,139,253,0.2)] text-[#58a6ff] border-[rgba(56,139,253,0.3)]'
                                    : 'bg-transparent text-[var(--text-muted)] border-[var(--border-color)]'
                                    }`}
                            >
                                {landscape ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            </button>
                            {/* Quality toggle */}
                            <button
                                onClick={cycleQuality}
                                title={`Quality: ${quality}`}
                                className={`${toolBtnCls} text-[10px] font-semibold min-w-8`}
                            >
                                {quality.toUpperCase()}
                            </button>
                            {zoom > 1 && (
                                <button
                                    onClick={() => { setZoom(1); setPanOffset({ x: 0, y: 0 }); }}
                                    title="Reset zoom"
                                    className="bg-[rgba(56,139,253,0.2)] text-[#58a6ff] border border-[rgba(56,139,253,0.3)] rounded-md px-2 py-1 cursor-pointer text-[10px] font-semibold"
                                >
                                    {Math.round(zoom * 100)}%
                                </button>
                            )}
                            {/* Clipboard copy/paste */}
                            <button onClick={handleCopy} title={t('mobile.stream.copyFromIde')} className={toolBtnCls}>
                                <Copy size={14} />
                            </button>
                            <button onClick={handlePaste} title={t('mobile.stream.pasteToIde')} className={toolBtnCls}>
                                <ClipboardPaste size={14} />
                            </button>
                            <span className="text-[11px] px-2 py-0.5 rounded-[10px] bg-[rgba(46,160,67,0.2)] text-[#3fb950] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-[#3fb950] inline-block" />
                                {fps > 0 ? `${fps}fps` : t('mobile.stream.live')}
                            </span>
                            <button
                                onClick={stopStream}
                                className="bg-[rgba(248,81,73,0.15)] text-[#f85149] border border-[rgba(248,81,73,0.3)] rounded-md px-2 py-1 cursor-pointer flex items-center gap-1 text-xs"
                            >
                                <Square size={12} fill="#f85149" />{t('mobile.common.stop')}
                            </button>
                        </>
                    )}
                    {!streaming && (
                        <button
                            onClick={startStream}
                            className="bg-[var(--accent-primary)] text-white border-none rounded-md px-4 py-1.5 text-[13px] cursor-pointer flex items-center gap-1"
                        >
                            <Play size={13} fill="white" />{t('mobile.common.start')}
                        </button>
                    )}
                </div>
            </div>

            {/* Stream Content */}
            <div className="flex-1 overflow-hidden flex items-center justify-center bg-[#0d1117] touch-none relative">
                {frame ? (
                    <>
                        <img
                            ref={imgRef}
                            src={frame}
                            alt={t('mobile.stream.ideStream')}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUp}
                            onMouseLeave={handleMouseUp}
                            onContextMenu={handleContextMenu}
                            onWheel={handleWheel}
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                            className={`max-w-full max-h-full w-auto h-auto object-contain select-none ${zoom > 1 ? 'cursor-grab' : 'cursor-pointer'}`}
                            style={{
                                transform: zoom > 1 ? `scale(${zoom}) translate(${panOffset.x / zoom}px, ${panOffset.y / zoom}px)` : undefined,
                                transformOrigin: 'center center',
                                transition: gestureModeRef.current === 'pinch' ? 'none' : 'transform 0.1s ease-out',
                            }}
                            draggable={false}
                        />
                        {/* Tap feedback dot */}
                        {tapFeedback && (
                            <div
                                className="absolute w-6 h-6 rounded-full bg-[rgba(88,166,255,0.5)] border-2 border-[rgba(88,166,255,0.8)] pointer-events-none animate-[tapPulse_0.4s_ease-out_forwards]"
                                style={{ left: tapFeedback.x - 12, top: tapFeedback.y - 12 }}
                            />
                        )}
                    </>
                ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-muted)]">
                        <div class="spinner w-5 h-5" />
                        <span className="text-[13px]">{t('mobile.stream.connectingToIde')}</span>
                    </div>
                )}
            </div>

            {/* Hidden input for keyboard capture — never visible */}
            {streaming && (
                <>
                    <input
                        ref={inputRef}
                        type="text"
                        onKeyDown={handleKeyDown}
                        onInput={handleInput}
                        className="absolute -left-[9999px] -top-[9999px] opacity-0 w-px h-px pointer-events-none"
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellcheck={false}
                    />
                    <div className="px-4 py-1.5 bg-[var(--bg-secondary)] border-t border-[var(--border-color)] flex items-center justify-between text-[11px] text-[var(--text-muted)]">
                        <span>{t('mobile.stream.touchHint')}</span>
                        <span>{t('mobile.stream.keysToIde')}</span>
                    </div>
                </>
            )}
        </div>
    );
}
