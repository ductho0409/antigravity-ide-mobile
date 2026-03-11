/**
 * useChatPolling — Live IDE chat snapshot
 * Primary: real-time WS push via chatUpdateRef (server broadcasts on change)
 * Fallback: HTTP polling every 10s (catches missed WS events, first-load)
 *
 * Visual jump fix: morphdom incremental DOM diff instead of innerHTML replacement
 * → preserves unchanged DOM nodes, no full repaint, scroll preserved naturally
 */
import { useEffect, useRef, useCallback } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import { authFetch, getServerUrl } from './useApi';

interface ChatSnapshot {
  html: string;
  css?: string;
  bodyBg?: string;
  bodyColor?: string;
  error?: string;
}

interface PollingOptions {
  /** Fallback polling interval in ms (default 10000) */
  interval?: number;
  /** Called when new HTML is rendered into the container */
  onRender?: (container: HTMLElement) => void;
  /** Ref from AppContext — receives WS push updates */
  chatUpdateRef?: MutableRef<((data: Record<string, unknown>) => void) | null>;
  /** Ref: timestamp until which user scroll lock is active (prevents auto-scroll) */
  userScrollLockRef?: MutableRef<number>;
  /** Ref: flag to indicate programmatic scrolling (so scroll listener ignores it) */
  isAutoScrollingRef?: MutableRef<boolean>;
}

/** DJB2 hash for fast content change detection */
function djb2Hash(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Cascade container CSS injection (inline fix rules from chat-live.js) */
const CASCADE_FIX_CSS = `
  #cascade-container {
    background: transparent !important;
    width: 100% !important;
    /* overflow-y intentionally NOT set — .cascade-view { overflow-y: auto } controls scrolling */
    overflow-x: hidden !important;
    position: relative !important;
    overscroll-behavior-y: contain !important;
    --ide-text-color: var(--text-primary) !important;
  }
  #cascade-container [style*="min-height"] { min-height: 0 !important; }
  #cascade-container .bg-gray-500\\/10:not(:has(*)),
  #cascade-container [class*="bg-gray-500"]:not(:has(*)) { display: none !important; }
  #cascade-container .codicon, #cascade-container [class*="codicon-"] { font-family: 'codicon' !important; }
  /* Keep file mentions inline */
  #cascade-container .context-scope-mention, #cascade-container [class*="context-scope"] {
    display: inline !important; vertical-align: middle !important;
  }
  #cascade-container span[draggable="true"],
  #cascade-container span[draggable="true"].flex,
  #cascade-container span[draggable="true"].inline-flex,
  #cascade-container .context-scope-mention span[draggable="true"],
  #cascade-container [data-file-path][draggable="true"] {
    display: inline-flex !important; align-items: center !important;
    vertical-align: middle !important; gap: 2px !important; max-width: 100% !important;
  }
  #cascade-container span[draggable="true"] > span { display: inline !important; }
  #cascade-container .break-all, #cascade-container [class*="break-all"] {
    display: inline !important; word-break: break-all !important;
  }
  /* File reference chips — accent color */
  #cascade-container .context-scope-mention span[draggable="true"],
  #cascade-container [data-file-path][draggable="true"] {
    color: var(--accent-primary) !important;
  }
  /* Inline code styling */
  #cascade-container code:not(pre code) {
    background: var(--bg-warning) !important;
    color: var(--warning) !important;
    padding: 1px 5px !important;
    border-radius: 3px !important;
    font-family: ui-monospace, monospace !important;
    font-size: 0.88em !important;
  }
  #cascade-container [data-file-path]:not([class*="border"][class*="rounded"]):not(div) {
    display: inline !important; vertical-align: middle !important;
  }
  #cascade-container .inline-flex { display: inline-flex !important; }
  #cascade-container .items-center { align-items: center !important; }
  #cascade-container span.flex, #cascade-container a.flex, #cascade-container code.flex {
    display: inline-flex !important;
  }
  /* Kill ALL animations, transitions, smooth-scroll inside cascade (prevents visual jump) */
  #cascade-container * {
    animation-duration: 0.001ms !important;
    animation-delay: 0s !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    transition-delay: 0s !important;
    scroll-behavior: auto !important;
  }
`;

export function useChatPolling(
  containerRef: { current: HTMLElement | null },
  styleRef: { current: HTMLElement | null },
  active: boolean,
  options: PollingOptions = {},
): { restartPolling: () => void } {
  const lastHashRef = useRef<string | null>(null);
  const lastCssRef = useRef<string>('');
  const optRef = useRef(options);
  optRef.current = options;

  // ─── Core render function (shared by WS push + polling) ──────────
  const renderSnapshot = useCallback((data: ChatSnapshot) => {
    const container = containerRef.current;
    const styleEl = styleRef.current;
    if (!container || !styleEl || !data.html) return;

    const hash = djb2Hash(data.html);
    if (hash === lastHashRef.current) return; // No change
    lastHashRef.current = hash;

    // ── CSS: only inject when actually changed (prevents reflow) ──
    const newCss = (data.css || '') + CASCADE_FIX_CSS;
    if (newCss !== lastCssRef.current) {
      lastCssRef.current = newCss;
      styleEl.textContent = newCss;
    }

    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100;
    const savedScrollTop = container.scrollTop;

    const finalizeRender = () => {
      // Fix file chip display (block → inline-flex)
      container.querySelectorAll('span[draggable="true"]').forEach((chip) => {
        (chip as HTMLElement).style.display = 'inline-flex';
      });
      container.querySelectorAll('span.flex').forEach((el) => {
        el.classList.remove('flex');
        if (!el.classList.contains('inline-flex')) el.classList.add('inline-flex');
      });

      // Invoke onRender callback (for attaching interactive handlers)
      optRef.current.onRender?.(container);

      // ── Lock-aware scroll restoration ──
      const lockRef = optRef.current.userScrollLockRef;
      const autoRef = optRef.current.isAutoScrollingRef;
      const isLocked = lockRef && lockRef.current > Date.now();

      if (isLocked) {
        // User is actively scrolling — restore by percentage to avoid jump
        const maxScroll = container.scrollHeight - container.clientHeight;
        if (maxScroll > 0 && savedScrollTop > 0) {
          const pct = savedScrollTop / (container.scrollHeight - container.clientHeight || 1);
          container.scrollTop = Math.round(pct * maxScroll);
        } else {
          container.scrollTop = savedScrollTop;
        }
      } else if (isAtBottom) {
        // Was at bottom + not locked → auto-scroll to bottom with flag
        if (autoRef) autoRef.current = true;
        container.scrollTop = container.scrollHeight;
        if (autoRef) {
          setTimeout(() => { autoRef.current = false; }, 400);
        }
      } else {
        // Not at bottom, not locked → restore exact position
        container.scrollTop = savedScrollTop;
      }
    };

    // Use morphdom instead of innerHTML to prevent full DOM recreation
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = data.html;

    // Check if morphdom is available (it should be since it's in package.json)
    // We import it dynamically if not imported at top
    import('morphdom').then(({ default: morphdom }) => {
      morphdom(container, tempDiv, {
        childrenOnly: true,
        onBeforeElUpdated: function (fromEl, toEl) {
          // Prevent morphdom from stripping our custom handler attributes
          // Doing this BEFORE isEqualNode ensures identical nodes evaluate to true perfectly
          if (fromEl.hasAttribute('data-handler-attached')) {
            toEl.setAttribute('data-handler-attached', 'true');
          }
          if (fromEl.hasAttribute('data-mobile-action')) {
            toEl.setAttribute('data-mobile-action', fromEl.getAttribute('data-mobile-action')!);
          }

          // Preserve <details> open state if the user expanded it
          if (fromEl.nodeName === 'DETAILS' && fromEl.hasAttribute('open')) {
            toEl.setAttribute('open', '');
          }

          // Preserve inner scroll positions (e.g. <pre> horizontally scrolled or nested containers)
          if (fromEl.scrollTop) {
            toEl.setAttribute('data-preserve-scroll-top', fromEl.scrollTop.toString());
          }
          if (fromEl.scrollLeft) {
            toEl.setAttribute('data-preserve-scroll-left', fromEl.scrollLeft.toString());
          }

          if (fromEl.isEqualNode(toEl)) {
            return false;
          }
          return true;
        },
        onElUpdated: function (el) {
          // Restore the preserved inner scroll positions immediately after the DOM node is updated
          if (el.hasAttribute('data-preserve-scroll-top')) {
            el.scrollTop = parseInt(el.getAttribute('data-preserve-scroll-top') || '0', 10);
            el.removeAttribute('data-preserve-scroll-top');
          }
          if (el.hasAttribute('data-preserve-scroll-left')) {
            el.scrollLeft = parseInt(el.getAttribute('data-preserve-scroll-left') || '0', 10);
            el.removeAttribute('data-preserve-scroll-left');
          }
        }
      });
      finalizeRender();
    }).catch(() => {
      // Fallback if morphdom fails to load
      container.innerHTML = data.html;
      finalizeRender();
    });
  }, [containerRef, styleRef]);

  // ─── Fallback HTTP poll (10s — catches missed WS + first load) ───
  const fetchLiveChat = useCallback(async () => {
    const container = containerRef.current;
    if (!container) return;

    try {
      const res = await authFetch(`${getServerUrl()}/api/chat/snapshot`);
      const data: ChatSnapshot = await res.json();

      if (data.html) {
        renderSnapshot(data);
      } else if (data.error || !data.html || data.html.trim().length < 50) {
        const msg = data.error || '';
        const isNoChat = msg.includes('not found') || msg.includes('No chat') || !data.html;

        if (isNoChat) {
          container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="opacity:0.5">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <h3 class="empty-state-title">No Active Chat</h3>
              <p class="empty-state-desc">Open a chat in Antigravity IDE to see it here</p>
              <div class="empty-state-tips">
                <div class="empty-state-tip">Open Cascade panel in IDE</div>
                <div class="empty-state-tip">Type a message to start</div>
                <div class="empty-state-tip">Or tap New Chat above</div>
              </div>
            </div>`;
        } else {
          container.innerHTML = `
            <div class="empty-state">
              <div class="empty-state-icon" style="opacity:0.6">&#9888;</div>
              <p class="empty-state-desc">${msg.replace(/</g, '&lt;')}</p>
            </div>`;
        }
      }
    } catch (_e) {
      // Silent fail for polling
    }
  }, [containerRef, renderSnapshot]);

  /**
   * Restart — clear cached hash so next fetch always re-renders
   */
  const restartPolling = useCallback(() => {
    lastHashRef.current = null;
    fetchLiveChat();
  }, [fetchLiveChat]);

  // ─── Register WS push handler ─────────────────────────────────────
  useEffect(() => {
    const chatUpdateRef = optRef.current.chatUpdateRef;
    if (!chatUpdateRef || !active) return;

    const handleWsUpdate = (data: Record<string, unknown>) => {
      renderSnapshot({
        html: data.html as string,
        css: data.css as string | undefined,
        bodyBg: data.bodyBg as string | undefined,
        bodyColor: data.bodyColor as string | undefined,
      });
    };
    chatUpdateRef.current = handleWsUpdate;

    return () => {
      if (chatUpdateRef.current === handleWsUpdate) {
        chatUpdateRef.current = null;
      }
    };
  }, [active, renderSnapshot]);

  // ─── Fallback HTTP polling (10s) ──────────────────────────────────
  useEffect(() => {
    if (!active) return;

    lastHashRef.current = null;
    fetchLiveChat(); // immediate fetch on mount / activation
    const interval = optRef.current.interval || 10000;
    const timer = setInterval(fetchLiveChat, interval);

    return () => {
      clearInterval(timer);
      // Clear injected IDE CSS when leaving chat tab.
      // <style> tags inside display:none parents still apply globally,
      // so IDE CSS (which may contain global selectors) would break
      // scroll/overflow on other panels if left active.
      if (styleRef.current) {
        styleRef.current.textContent = '';
      }
      lastCssRef.current = '';
    };
  }, [active, fetchLiveChat]);

  return { restartPolling };
}
