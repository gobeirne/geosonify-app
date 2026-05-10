/**
 * geosonify-lazy-load.js v1.0
 * 
 * Lazy loading utility for external scripts and resources.
 * Keeps initial page load fast by deferring heavy dependencies.
 * 
 * Usage:
 *   await LazyLoad.script('https://example.com/heavy-lib.js');
 *   await LazyLoad.script('lib.js', { global: 'LibName' }); // Wait for global
 *   await LazyLoad.css('styles.css');
 */

(function(global) {
  'use strict';

  // Track what's been loaded
  const loaded = new Map();  // url → Promise
  const globals = new Map(); // url → global name to wait for

  const LazyLoad = {
    /**
     * Load a JavaScript file
     * @param {string} url - Script URL
     * @param {Object} [options]
     * @param {string} [options.global] - Global variable name to wait for
     * @param {number} [options.timeout=30000] - Timeout in ms
     * @returns {Promise<void>}
     */
    async script(url, options = {}) {
      // Return existing promise if already loading/loaded
      if (loaded.has(url)) {
        return loaded.get(url);
      }

      const promise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = url;
        script.async = true;

        const timeout = options.timeout || 30000;
        let timeoutId;

        const cleanup = () => {
          clearTimeout(timeoutId);
          script.onload = null;
          script.onerror = null;
        };

        script.onload = () => {
          cleanup();
          
          // If waiting for a global, poll for it
          if (options.global) {
            const checkGlobal = (attempts = 0) => {
              if (global[options.global] !== undefined) {
                resolve();
              } else if (attempts > 100) {
                reject(new Error(`Global "${options.global}" not found after loading ${url}`));
              } else {
                setTimeout(() => checkGlobal(attempts + 1), 50);
              }
            };
            checkGlobal();
          } else {
            resolve();
          }
        };

        script.onerror = () => {
          cleanup();
          loaded.delete(url);
          reject(new Error(`Failed to load script: ${url}`));
        };

        timeoutId = setTimeout(() => {
          cleanup();
          loaded.delete(url);
          reject(new Error(`Timeout loading script: ${url}`));
        }, timeout);

        document.head.appendChild(script);
      });

      loaded.set(url, promise);
      return promise;
    },

    /**
     * Load a CSS file
     * @param {string} url - Stylesheet URL
     * @returns {Promise<void>}
     */
    async css(url) {
      if (loaded.has(url)) {
        return loaded.get(url);
      }

      const promise = new Promise((resolve, reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = url;

        link.onload = () => resolve();
        link.onerror = () => {
          loaded.delete(url);
          reject(new Error(`Failed to load CSS: ${url}`));
        };

        document.head.appendChild(link);
      });

      loaded.set(url, promise);
      return promise;
    },

    /**
     * Preload a resource (doesn't execute, just caches)
     * @param {string} url - Resource URL
     * @param {string} [as='script'] - Resource type
     */
    preload(url, as = 'script') {
      if (document.querySelector(`link[rel="preload"][href="${url}"]`)) {
        return;
      }
      
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = as;
      link.href = url;
      document.head.appendChild(link);
    },

    /**
     * Check if a URL has been loaded
     * @param {string} url
     * @returns {boolean}
     */
    isLoaded(url) {
      const promise = loaded.get(url);
      if (!promise) return false;
      
      // Check if promise is resolved
      let resolved = false;
      promise.then(() => { resolved = true; }).catch(() => {});
      return resolved;
    },

    /**
     * Load multiple scripts in parallel
     * @param {Array<string|{url: string, options?: Object}>} urls
     * @returns {Promise<void>}
     */
    async scripts(urls) {
      const promises = urls.map(item => {
        if (typeof item === 'string') {
          return this.script(item);
        }
        return this.script(item.url, item.options);
      });
      await Promise.all(promises);
    }
  };

  // ============== COMMON LIBRARIES ==============
  
  // Convenience methods for common heavy dependencies
  
  LazyLoad.opencv = async function() {
    await this.script('https://docs.opencv.org/4.x/opencv.js', {
      global: 'cv',
      timeout: 60000  // OpenCV is large, give it more time
    });
    return global.cv;
  };

  LazyLoad.tone = async function() {
    await this.script('https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js', {
      global: 'Tone'
    });
    return global.Tone;
  };

  // ============== EXPORT ==============

  global.LazyLoad = LazyLoad;

  console.log('[geosonify] lazy-load v1.0 loaded');

})(typeof window !== 'undefined' ? window : this);
