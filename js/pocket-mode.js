/**
 * geosonify-pocket-mode.js v1.0
 * 
 * "Pocket mode" overlay for safe phone carrying during playback.
 * - Full black screen to prevent accidental touches
 * - Wake lock to keep app running
 * - Tap and hold to unlock
 * 
 * Usage:
 *   PocketMode.enable()   - Show overlay, acquire wake lock
 *   PocketMode.disable()  - Hide overlay, release wake lock
 *   PocketMode.toggle()   - Toggle state
 *   PocketMode.isActive   - Check current state
 */

(function(global) {
  'use strict';

  // ============== STATE ==============
  
  let isActive = false;
  let overlay = null;
  let wakeLock = null;
  let holdTimer = null;
  let holdStartTime = null;
  let progressRing = null;
  
  const HOLD_DURATION_MS = 1500; // 1.5 seconds to unlock
  
  // ============== STYLES ==============
  
  const STYLES = `
    .pocket-mode-overlay {
      position: fixed;
      inset: 0;
      background: #000;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      cursor: default;
    }
    
    .pocket-mode-title {
      font-family: 'Courier New', Courier, monospace;
      font-size: 28px;
      letter-spacing: 2px;
      margin-bottom: 60px;
    }
    
    .pocket-mode-title .geo {
      color: #222;
    }
    
    .pocket-mode-title .sonify {
      color: #222;
    }
    
    .pocket-mode-title .ing {
      color: #1a1a1a;
    }
    
    .pocket-mode-title .dots {
      color: #1a1a1a;
    }
    
    .pocket-mode-hint {
      color: #1a1a1a;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      position: absolute;
      bottom: 80px;
      transition: opacity 0.3s, color 0.3s;
    }
    
    .pocket-mode-hint.holding {
      color: #333;
    }
    
    .pocket-mode-progress {
      position: absolute;
      bottom: 120px;
      width: 60px;
      height: 60px;
      opacity: 0;
      transition: opacity 0.2s;
    }
    
    .pocket-mode-progress.active {
      opacity: 1;
    }
    
    .pocket-mode-progress circle {
      fill: none;
      stroke: #333;
      stroke-width: 3;
      stroke-linecap: round;
      transform: rotate(-90deg);
      transform-origin: center;
    }
    
    .pocket-mode-progress .progress-track {
      stroke: #111;
    }
    
    .pocket-mode-progress .progress-fill {
      stroke: #444;
      stroke-dasharray: 157; /* 2 * PI * 25 (radius) */
      stroke-dashoffset: 157;
      transition: stroke-dashoffset 0.1s linear;
    }
    
    /* Button for triggering pocket mode */
    .pocket-mode-btn {
      background: #111;
      border: 1px solid #333;
      color: #666;
      width: 36px;
      height: 36px;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      transition: all 0.2s;
    }
    
    .pocket-mode-btn:hover {
      background: #222;
      border-color: #444;
      color: #888;
    }
    
    .pocket-mode-btn:active {
      background: #000;
    }
  `;

  // ============== HELPERS ==============
  
  function injectStyles() {
    if (document.getElementById('pocket-mode-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'pocket-mode-styles';
    style.textContent = STYLES;
    document.head.appendChild(style);
  }
  
  function createOverlay() {
    const el = document.createElement('div');
    el.className = 'pocket-mode-overlay';
    el.innerHTML = `
      <div class="pocket-mode-title">
        <span class="geo">geosonify</span><span class="ing">ing</span><span class="dots">…</span>
      </div>
      <svg class="pocket-mode-progress" viewBox="0 0 60 60">
        <circle class="progress-track" cx="30" cy="30" r="25"/>
        <circle class="progress-fill" cx="30" cy="30" r="25"/>
      </svg>
      <div class="pocket-mode-hint">hold to unlock</div>
    `;
    return el;
  }
  
  // ============== WAKE LOCK ==============
  
  async function acquireWakeLock() {
    if (!('wakeLock' in navigator)) {
      console.warn('[PocketMode] Wake Lock API not supported');
      return false;
    }
    
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('[PocketMode] Wake lock acquired');
      
      // Re-acquire if released (e.g., tab visibility change)
      wakeLock.addEventListener('release', () => {
        console.log('[PocketMode] Wake lock released');
        // Try to re-acquire if still in pocket mode
        if (isActive) {
          acquireWakeLock();
        }
      });
      
      return true;
    } catch (err) {
      console.warn('[PocketMode] Wake lock failed:', err.message);
      return false;
    }
  }
  
  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
      console.log('[PocketMode] Wake lock released manually');
    }
  }
  
  // ============== TOUCH HANDLING ==============
  
  function updateProgress(progress) {
    if (!progressRing) return;
    
    // progress is 0-1
    const circumference = 157; // 2 * PI * 25
    const offset = circumference * (1 - progress);
    progressRing.style.strokeDashoffset = offset;
  }
  
  function startHold() {
    holdStartTime = Date.now();
    
    const hint = overlay.querySelector('.pocket-mode-hint');
    const progressSvg = overlay.querySelector('.pocket-mode-progress');
    progressRing = overlay.querySelector('.progress-fill');
    
    hint.classList.add('holding');
    progressSvg.classList.add('active');
    
    // Animate progress
    const animateProgress = () => {
      if (!holdStartTime) return;
      
      const elapsed = Date.now() - holdStartTime;
      const progress = Math.min(elapsed / HOLD_DURATION_MS, 1);
      updateProgress(progress);
      
      if (progress < 1) {
        holdTimer = requestAnimationFrame(animateProgress);
      }
    };
    
    holdTimer = requestAnimationFrame(animateProgress);
    
    // Set unlock timer
    holdTimer = setTimeout(() => {
      // Vibrate if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }
      PocketMode.disable();
    }, HOLD_DURATION_MS);
  }
  
  function cancelHold() {
    holdStartTime = null;
    
    if (holdTimer) {
      clearTimeout(holdTimer);
      cancelAnimationFrame(holdTimer);
      holdTimer = null;
    }
    
    if (overlay) {
      const hint = overlay.querySelector('.pocket-mode-hint');
      const progressSvg = overlay.querySelector('.pocket-mode-progress');
      
      if (hint) hint.classList.remove('holding');
      if (progressSvg) progressSvg.classList.remove('active');
    }
    
    updateProgress(0);
  }
  
  function handleTouchStart(e) {
    e.preventDefault();
    e.stopPropagation();
    startHold();
  }
  
  function handleTouchEnd(e) {
    e.preventDefault();
    e.stopPropagation();
    cancelHold();
  }
  
  function handleTouchMove(e) {
    e.preventDefault();
    e.stopPropagation();
    // Cancel if finger moves too much
    cancelHold();
  }
  
  // Block all other events
  function blockEvent(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // ============== PUBLIC API ==============
  
  const PocketMode = {
    
    /**
     * Enable pocket mode - show overlay and acquire wake lock
     */
    async enable() {
      if (isActive) return;
      
      injectStyles();
      
      // Create and show overlay
      overlay = createOverlay();
      document.body.appendChild(overlay);
      
      // Set up touch handlers
      overlay.addEventListener('touchstart', handleTouchStart, { passive: false });
      overlay.addEventListener('touchend', handleTouchEnd, { passive: false });
      overlay.addEventListener('touchmove', handleTouchMove, { passive: false });
      overlay.addEventListener('touchcancel', handleTouchEnd, { passive: false });
      
      // Block mouse events too (for testing on desktop)
      overlay.addEventListener('mousedown', handleTouchStart);
      overlay.addEventListener('mouseup', handleTouchEnd);
      overlay.addEventListener('mouseleave', handleTouchEnd);
      
      // Block everything else
      overlay.addEventListener('click', blockEvent, true);
      overlay.addEventListener('dblclick', blockEvent, true);
      overlay.addEventListener('contextmenu', blockEvent, true);
      
      // Acquire wake lock
      await acquireWakeLock();
      
      isActive = true;
      console.log('[PocketMode] Enabled');
      
      // Dispatch event for other modules
      window.dispatchEvent(new CustomEvent('pocketmodechange', { detail: { active: true } }));
    },
    
    /**
     * Disable pocket mode - hide overlay and release wake lock
     */
    disable() {
      if (!isActive) return;
      
      cancelHold();
      
      // Remove overlay
      if (overlay) {
        overlay.remove();
        overlay = null;
      }
      
      // Release wake lock
      releaseWakeLock();
      
      isActive = false;
      console.log('[PocketMode] Disabled');
      
      // Dispatch event for other modules
      window.dispatchEvent(new CustomEvent('pocketmodechange', { detail: { active: false } }));
    },
    
    /**
     * Toggle pocket mode
     */
    toggle() {
      if (isActive) {
        this.disable();
      } else {
        this.enable();
      }
    },
    
    /**
     * Check if pocket mode is active
     */
    get isActive() {
      return isActive;
    },
    
    /**
     * Create a button to trigger pocket mode
     * @returns {HTMLButtonElement}
     */
    createButton() {
      injectStyles();
      
      const btn = document.createElement('button');
      btn.className = 'pocket-mode-btn';
      btn.innerHTML = '⬛';
      btn.title = 'Pocket mode (lock screen)';
      btn.onclick = () => this.enable();
      
      return btn;
    }
  };
  
  // ============== EXPORT ==============
  
  global.PocketMode = PocketMode;
  
  console.log('[geosonify] pocket-mode v1.0 loaded');
  
})(typeof window !== 'undefined' ? window : this);
