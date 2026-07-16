/**
 * Cataseek AI Search - Frontend Widget
 *
 * @author    gofenice
 * @copyright 2026 gofenice
 */
(function () {
  "use strict";
  document.addEventListener("DOMContentLoaded", function () {
    if (typeof cataseekConfig === "undefined") return;
    var config = cataseekConfig;
    var apiUrl = config.apiUrl;
    var apiKey = config.apiKey;
    var minChars = parseInt(config.minChars) || 2;
    var currency = config.currency || "$";
    var trendingTitle = config.trendingTitle || "Trending Products";
    var cachedDiscoveryHtml = null;
    var isFetchingDiscovery = false;
    // --- State ---
    var state = {
      query: "",
      offset: 0,
      limit: 12,
      total: 0,
      isLoading: false,
      isLoadingMore: false,
      hasMore: true,
      selectedFilters: {
        categories: [],
      },
      priceRange: {
        min: null,
        max: null,
        currentMin: null,
        currentMax: null,
      },
      sort: "relevance",
      debounceTimer: null,
      dwellTimer: null, // fires a count_only request after 5s of stable results
      dwellFiredForQuery: null, // tracks which exact query text has already been counted
      facets: null,
      facetStats: null,
    };
    // --- Dwell Timer (search counting gatekeeper) ---
    // The live /search calls never count. Only after the user stays on
    // the same results for DWELL_MS without typing does a lightweight
    // count_only request fire — exactly once per settled query.
    var DWELL_MS = 5000;

    function cancelDwellTimer() {
      if (state.dwellTimer) {
        clearTimeout(state.dwellTimer);
        state.dwellTimer = null;
      }
    }

    function startDwellTimer(query) {
      // Already counted this exact query (e.g. user just tweaked a filter
      // on a search that already settled) — don't restart the clock or recount
      if (state.dwellFiredForQuery === query) return;

      cancelDwellTimer();
      var countedQuery = query;
      state.dwellTimer = setTimeout(function () {
        // Guard: only fire if the query is still the same
        if (state.query === countedQuery && countedQuery.length > 0) {
          fireDwellCount(countedQuery);
          state.dwellFiredForQuery = countedQuery; // mark as counted
        }
        state.dwellTimer = null;
      }, DWELL_MS);
    }

    function fireDwellCount(q) {
      var domain = config.shopDomain || window.location.hostname;
      var payload = { query: q, count_only: true, result_count: state.total };
      if (config.language) payload.language = config.language;
      if (config.storeId) payload.store_id = config.storeId;
      fetch(apiUrl + "/products/public/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Store-Domain": domain,
        },
        body: JSON.stringify(payload),
      }).catch(function () {}); // fire-and-forget — never affects UX
    }
    // --- DOM Elements ---
    var triggerBtn = document.getElementById("cataseek-search-trigger");
    var modal = document.getElementById("cataseek-modal");
    var modalContent = modal
      ? modal.querySelector(".cataseek-modal-content")
      : null;
    var modalOverlay = modal
      ? modal.querySelector(".cataseek-modal-overlay")
      : null;
    var modalBody = modal ? modal.querySelector(".cataseek-modal-body") : null;
    var contentArea = modal
      ? modal.querySelector(".cataseek-content-area")
      : null;
    var closeBtn = document.getElementById("cataseek-modal-close");
    var searchInput = document.getElementById("cataseek-search-input");
    var resultsContainer = document.getElementById("cataseek-search-results");
    var filtersSidebar = document.getElementById("cataseek-filters");
    var mobileFilterBtn = document.getElementById("cataseek-mobile-filter-btn");
    var filterOverlay = document.getElementById("cataseek-filter-overlay");
    var loadingEl = document.getElementById("cataseek-loading");
    var noResultsEl = document.getElementById("cataseek-no-results");
    var resultsCountEl = document.getElementById("cataseek-results-count");
    var sortSelect = document.getElementById("cataseek-sort-select");
    var sortingContainer = modal
      ? modal.querySelector(".cataseek-sorting")
      : null;
    var voiceBtn = document.getElementById("cataseek-voice-search-btn");
    // --- Suggestion System DOM Refs ---
    var searchInputWrapper = modal
      ? modal.querySelector(".cataseek-search-input-wrapper")
      : null;
    var suggestionBar = document.getElementById("cataseek-suggestions-bar");
    var suggestionPills = document.getElementById("cataseek-suggestions-pills");
    if (!modal) return;
    // Apply theme color
    document.documentElement.style.setProperty(
      "--cataseek-color",
      config.color,
    );
    document.documentElement.style.setProperty(
      "--cataseek-color-dark",
      shadeColor(config.color, -20),
    );
    // --- Custom Selector Override ---
    // If a custom selector is configured, intercept those elements to open the Cataseek modal.
    // The module's own trigger icon is hidden in this case.
    var customSelector = (config.selector || "").trim();
    if (customSelector) {
      var selectorTargets;
      try {
        selectorTargets = document.querySelectorAll(customSelector);
      } catch (e) {
        console.warn("[Cataseek] Invalid selector:", customSelector, e);
        selectorTargets = [];
      }
      if (selectorTargets.length > 0) {
        // Hide our own icon since the native element becomes the trigger
        if (triggerBtn) triggerBtn.style.display = "none";
        selectorTargets.forEach(function (target) {
          // Intercept click on the element (and any children)
          target.addEventListener(
            "click",
            function (e) {
              e.preventDefault();
              e.stopPropagation();
              openModal();
            },
            true,
          ); // use capture so we intercept before PS handlers
          // If the matched element is an <input>, also intercept focus
          if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
            target.addEventListener("focus", function (e) {
              target.blur(); // prevent native keyboard / autocomplete
              openModal();
            });
          }
          // Intercept <input> / <textarea> children too
          target
            .querySelectorAll(
              'input[type="text"], input[type="search"], textarea',
            )
            .forEach(function (inp) {
              inp.addEventListener("focus", function (e) {
                inp.blur();
                openModal();
              });
              inp.addEventListener(
                "click",
                function (e) {
                  e.preventDefault();
                  e.stopPropagation();
                  openModal();
                },
                true,
              );
            });
          // Intercept form submit to prevent native search from firing
          var form =
            target.tagName === "FORM" ? target : target.closest("form");
          if (!form) form = target.querySelector("form");
          if (form) {
            form.addEventListener("submit", function (e) {
              e.preventDefault();
              e.stopPropagation();
              openModal();
            });
          }
        });
      } else {
        // Selector set but no element found yet — try again after a short delay
        // (some themes render widgets after DOMContentLoaded)
        setTimeout(function () {
          try {
            document
              .querySelectorAll(customSelector)
              .forEach(function (target) {
                target.addEventListener(
                  "click",
                  function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    openModal();
                  },
                  true,
                );
                target
                  .querySelectorAll('input[type="text"], input[type="search"]')
                  .forEach(function (inp) {
                    inp.addEventListener("focus", function () {
                      inp.blur();
                      openModal();
                    });
                    inp.addEventListener(
                      "click",
                      function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        openModal();
                      },
                      true,
                    );
                  });
                var form =
                  target.tagName === "FORM"
                    ? target
                    : target.closest("form") || target.querySelector("form");
                if (form)
                  form.addEventListener("submit", function (e) {
                    e.preventDefault();
                    openModal();
                  });
              });
            if (triggerBtn) triggerBtn.style.display = "none";
          } catch (e) {
            /* invalid selector */
          }
        }, 500);
      }
    }
    // --- Own Trigger Button (used when no custom selector is set) ---
    if (triggerBtn && !customSelector) {
      triggerBtn.addEventListener("click", function (e) {
        e.preventDefault();
        openModal();
      });
    }
    if (mobileFilterBtn) {
      mobileFilterBtn.addEventListener("click", function (e) {
        e.preventDefault();
        if (filtersSidebar)
          filtersSidebar.classList.add("cataseek-filters-open");
        if (filterOverlay) filterOverlay.classList.add("cataseek-filters-open");
      });
    }
    if (filterOverlay) {
      filterOverlay.addEventListener("click", closeMobileFilters);
    }
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (modalOverlay) modalOverlay.addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (
        e.key === "Escape" &&
        modal.classList.contains("cataseek-modal-active")
      ) {
        closeModal();
      }
    });
    if (searchInput) {
      searchInput.addEventListener("input", function () {
        var qtrim = searchInput.value.trim();

        // Cancel any pending dwell count — the user is still typing
        cancelDwellTimer();

        if (qtrim.length < minChars) {
          hideSuggestions();
          showDiscoveryState();
          return;
        }
        if (qtrim === state.query) return;

        // Debounce the main search (suggestions now bundled in response)
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(function () {
          startNewSearch(qtrim);
        }, 150);
      });

      // Enter key — commits the search and saves to recent history
      searchInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          var q = searchInput.value.trim();
          if (q.length >= minChars) {
            saveRecentSearch(q);
            hideSuggestions();
            startNewSearch(q);
          }
        }
      });
    }
    // --- Voice Search ---
    var SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition && voiceBtn) {
      voiceBtn.style.display = "flex";
      // Detect language: config setting > html lang attribute > default 'en-US'
      var voiceLang = "en-US";
      if (config.language && config.language.length >= 2) {
        voiceLang = config.language;
      } else if (document.documentElement.lang) {
        voiceLang = document.documentElement.lang;
      }
      // Edge requires a full BCP-47 tag (e.g. "en-US", "es-ES").
      // A bare 2-letter code like "en" or "es" causes a silent 'network'
      // error in Edge's speech API. Expand known short codes to full locales.
      var langFallbackMap = {
        en: "en-US",
        es: "es-ES",
        fr: "fr-FR",
        de: "de-DE",
        it: "it-IT",
        pt: "pt-PT",
        nl: "nl-NL",
        pl: "pl-PL",
        ru: "ru-RU",
        ja: "ja-JP",
        zh: "zh-CN",
        ko: "ko-KR",
        ar: "ar-SA",
        tr: "tr-TR",
        sv: "sv-SE",
        da: "da-DK",
        fi: "fi-FI",
        nb: "nb-NO",
        cs: "cs-CZ",
        hu: "hu-HU",
        ro: "ro-RO",
        sk: "sk-SK",
        bg: "bg-BG",
        hr: "hr-HR",
        uk: "uk-UA",
        el: "el-GR",
        he: "he-IL",
        hi: "hi-IN",
        th: "th-TH",
        vi: "vi-VN",
        id: "id-ID",
        ms: "ms-MY",
      };
      if (voiceLang && !voiceLang.includes("-") && !voiceLang.includes("_")) {
        voiceLang =
          langFallbackMap[voiceLang.toLowerCase()] ||
          voiceLang + "-" + voiceLang.toUpperCase();
      }
      // Normalise underscore separator to hyphen (e.g. "en_US" → "en-US")
      voiceLang = voiceLang.replace("_", "-");
      var voiceActive = false;
      var recognition = null;
      // Handler functions declared as vars so they can be re-attached
      // to a fresh SpeechRecognition instance on every click (required for
      // Edge, which throws InvalidStateError if .start() is called on a
      // spent instance after onend fires).
      var onVoiceStart = function () {
        voiceActive = true;
        voiceBtn.classList.add("cataseek-voice-active");
        if (searchInput) {
          searchInput.placeholder =
            voiceLang.toLowerCase().indexOf("es") === 0
              ? "Escuchando..."
              : "Listening...";
        }
      };
      var onVoiceResult = function (event) {
        var result = event.results[event.results.length - 1];
        var isFinal = result.isFinal;
        var transcript = result[0].transcript
          .trim()
          // Strip trailing punctuation Edge appends (period, comma, question mark etc.)
          .replace(/[.,!?;:]+$/, "");
        if (searchInput && transcript) {
          searchInput.value = transcript;
          // Interim results: update input visually so user sees recognition
          // in progress, but don't fire a search yet to avoid API spam.
          // Final result: dispatch input to trigger the debounced search.
          if (isFinal) {
            searchInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      };
      var onVoiceError = function (event) {
        console.warn("[Cataseek] Voice recognition error:", event.error);
        // On Android Chrome, permission denial fires onerror but may skip
        // onend — reset state here to avoid a stuck active button.
        if (
          event.error === "not-allowed" ||
          event.error === "service-not-allowed"
        ) {
          voiceActive = false;
          voiceBtn.classList.remove("cataseek-voice-active");
          if (searchInput) {
            searchInput.placeholder =
              searchInput.getAttribute("placeholder") ||
              (voiceLang.toLowerCase().indexOf("es") === 0
                ? "Buscar productos..."
                : "Search for products...");
          }
        }
      };
      var onVoiceEnd = function () {
        voiceActive = false;
        voiceBtn.classList.remove("cataseek-voice-active");
        if (searchInput) {
          searchInput.placeholder =
            searchInput.getAttribute("placeholder") ||
            (voiceLang.toLowerCase().indexOf("es") === 0
              ? "Buscar productos..."
              : "Search for products...");
        }
      };
      voiceBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (voiceActive) {
          if (recognition) recognition.stop();
          return;
        }
        // Re-instantiate on every click so Edge doesn't reuse a spent object
        recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.interimResults = true; // show partial results for faster perceived response
        recognition.maxAlternatives = 1;
        recognition.lang = voiceLang;
        recognition.onstart = onVoiceStart;
        recognition.onresult = onVoiceResult;
        recognition.onerror = onVoiceError;
        recognition.onend = onVoiceEnd;
        try {
          recognition.start();
        } catch (err) {
          console.warn("[Cataseek] Voice search start error:", err);
        }
      });
    }
    if (sortSelect) {
      sortSelect.addEventListener("change", function () {
        state.sort = this.value;
        state.offset = 0;
        performSearch();
      });
    }
    if (contentArea) {
      contentArea.addEventListener("scroll", function () {
        var scrollTop = contentArea.scrollTop;
        var scrollHeight = contentArea.scrollHeight;
        var clientHeight = contentArea.clientHeight;
        if (scrollTop + clientHeight >= scrollHeight - 400) {
          loadMore();
        }
      });
    }
    // --- Modal Logic ---
    function openModal() {
      modal.style.display = "block";
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          modal.classList.add("cataseek-modal-active");
        });
      });
      if (searchInput) searchInput.focus();
      document.body.style.overflow = "hidden";
      if (!searchInput || searchInput.value.trim().length < minChars) {
        showDiscoveryState();
        // Show recent searches as suggestion pills immediately
        renderRecentPills();
      } else if (state.query && state.query.length > 0) {
        // Modal reopened with existing results still on screen.
        // The dwell timer was cancelled on close, so restart it —
        // if the user reads results for 5s this time, it will count.
        startDwellTimer(state.query);
      }
    }
    function closeModal() {
      cancelDwellTimer(); // never count a search the user abandoned by closing
      modal.classList.remove("cataseek-modal-active");
      closeMobileFilters();
      setTimeout(function () {
        modal.style.display = "none";
      }, 300);
      document.body.style.overflow = "";
    }
    function closeMobileFilters() {
      if (filtersSidebar)
        filtersSidebar.classList.remove("cataseek-filters-open");
      if (filterOverlay)
        filterOverlay.classList.remove("cataseek-filters-open");
    }
    // --- Search Logic ---
    // startNewSearch is called by the debounce (every keystroke) AND by explicit commits
    // (Enter key, pill click). It must NOT hide suggestions — the debounce path needs
    // them to stay visible and update smoothly. Only explicit commit callers hide them.
    function startNewSearch(query) {
        state.query = query;
        state.offset = 0;
        state.dwellFiredForQuery = null; // new query text — eligible to be counted again
        state.hasMore = true;
        state.selectedFilters.categories = [];
        state.priceRange.currentMin = null;
        state.priceRange.currentMax = null;
        showSkeletons();
        performSearch();
    }
    function resetSearchResults() {
      state.query = "";
      state.offset = 0;
      state.total = 0;
      resultsCountEl.innerText = "";
      resultsContainer.innerHTML = "";
      filtersSidebar.innerHTML = "";
      filtersSidebar.style.display = "none";
      if (sortingContainer) sortingContainer.style.display = "none";
      if (mobileFilterBtn) mobileFilterBtn.style.display = "none";
      closeMobileFilters();
    }
    function loadMore() {
      if (state.isLoading || state.isLoadingMore || !state.hasMore) return;
      state.isLoadingMore = true;
      state.offset += state.limit;
      performSearch(true);
    }
    function performSearch(isLoadMore) {
      if (!isLoadMore) state.isLoading = true;
      var domain = config.shopDomain || window.location.hostname;
      var sortArr = [];
      if (state.sort === "price:asc") sortArr = ["price:asc"];
      else if (state.sort === "price:desc") sortArr = ["price:desc"];
      var payload = {
        query: state.query,
        limit: state.limit,
      };
      if (state.offset > 0) {
        payload.offset = state.offset;
      }
      if (config.language) payload.language = config.language;
      if (config.storeId) payload.store_id = config.storeId;
      if (
        state.selectedFilters.categories &&
        state.selectedFilters.categories.length > 0
      ) {
        payload.categories = state.selectedFilters.categories;
      }
      if (sortArr.length > 0) {
        payload.sort = sortArr;
      }
      if (state.priceRange.currentMin !== null) {
        payload.min_price = state.priceRange.currentMin;
      }
      if (state.priceRange.currentMax !== null) {
        payload.max_price = state.priceRange.currentMax;
      }
      fetch(apiUrl + "/products/public/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Store-Domain": domain,
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          if (!res.ok) {
            return res.json().then(function (errData) {
              throw new Error(errData.error || "Server error: " + res.status);
            });
          }
          return res.json();
        })
        .then(function (data) {
          state.total = data.total;
          state.facets = data.facetDistribution;
          if (!isLoadMore) {
            state.facetStats = data.facetStats;
            // Initialize price range if not set
            if (
              state.facetStats &&
              state.facetStats.price &&
              state.priceRange.min === null
            ) {
              state.priceRange.min = Math.floor(state.facetStats.price.min);
              state.priceRange.max = Math.ceil(state.facetStats.price.max);
            }
          }
          if (isLoadMore) {
            appendResults(data.results);
          } else {
            renderResults(data.results);
            renderFilters();
            // Use suggestions bundled in the search response (no separate /suggestions call)
            if (data.suggestions && data.suggestions.length > 0) {
              renderSuggestionPills(data.suggestions, state.query);
            } else {
              hideSuggestions();
            }
            // Start the dwell timer — fires count_only after 5s of stable results
            if (state.query) startDwellTimer(state.query);
          }
          state.isLoading = false;
          state.isLoadingMore = false;
          state.hasMore =
            state.offset + (data.results ? data.results.length : 0) <
            state.total;
        })
        .catch(function (err) {
          console.error("[Cataseek] Search Error:", err);
          showError(err.message);
          state.isLoading = false;
          state.isLoadingMore = false;
        });
    }
    // --- UI Rendering ---
    function renderResults(hits) {
      hideAllStates();
      if (!hits || hits.length === 0) {
        noResultsEl.style.display = "flex";
        resultsCountEl.innerText = "0 results";
        return;
      }
      resultsCountEl.innerText = state.total + " results";
      if (sortingContainer) sortingContainer.style.display = "flex";
      var html =
        '<div class="cataseek-products-grid">' +
        hits
          .map(function (h) {
            return productCard(h, state.query);
          })
          .join("") +
        "</div>";
      resultsContainer.innerHTML = html;
      resultsContainer.style.display = "block";
    }
    function appendResults(hits) {
      if (!hits || hits.length === 0) return;
      var grid = resultsContainer.querySelector(".cataseek-products-grid");
      if (!grid) {
        renderResults(hits);
        return;
      }
      var temp = document.createElement("div");
      temp.innerHTML = hits
        .map(function (h) {
          return productCard(h, state.query);
        })
        .join("");
      while (temp.firstChild) {
        grid.appendChild(temp.firstChild);
      }
    }
    function productCard(product, query) {
      var imgSrc = product.images && product.images[0] ? product.images[0] : "";
      var name = highlight(escapeHtml(product.name || ""), query);
      var price = formatDisplayPrice(product.price);
      var url = escapeHtml(product.url || "#");
      var pid = escapeHtml(String(product.external_id || ""));
      var cartSvg =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>' +
        '<path d="M3 6h18"></path>' +
        '<path d="M16 10a4 4 0 0 1-8 0"></path>' +
        "</svg>";
      return (
        '<a href="' +
        url +
        '" class="cataseek-product-link">' +
        '<div class="cataseek-product-item">' +
        '<div class="cataseek-product-image">' +
        (imgSrc
          ? '<img src="' + escapeHtml(imgSrc) + '" alt="" loading="lazy">'
          : "") +
        "</div>" +
        '<div class="cataseek-product-info">' +
        '<h4 class="cataseek-product-name">' +
        name +
        "</h4>" +
        '<div class="cataseek-product-price">' +
        '<span class="cataseek-price-current">' +
        price +
        "</span>" +
        '<button class="cataseek-add-to-cart" data-pid="' +
        pid +
        '" title="Add to cart">' +
        cartSvg +
        "</button>" +
        "</div>" +
        "</div>" +
        "</div>" +
        "</a>"
      );
    }
    // --- Add to Cart Logic ---
    // Delegated handler: catches clicks on cart btn, stepper +/-, and confirm
    if (resultsContainer) {
      resultsContainer.addEventListener(
        "click",
        function (e) {
          var cartBtn = e.target.closest(".cataseek-add-to-cart");
          if (cartBtn && !cartBtn.closest(".cataseek-qty-wrapper")) {
            e.preventDefault();
            e.stopPropagation();
            expandToQuantityPicker(cartBtn);
            return;
          }
          var stepBtn = e.target.closest(".cataseek-qty-step");
          if (stepBtn) {
            e.preventDefault();
            e.stopPropagation();
            adjustQty(stepBtn);
            return;
          }
          var confirmBtn = e.target.closest(".cataseek-qty-confirm");
          if (confirmBtn) {
            e.preventDefault();
            e.stopPropagation();
            addToCart(confirmBtn);
            return;
          }
          var qtyInput = e.target.closest(".cataseek-qty-input");
          if (qtyInput) {
            e.preventDefault();
            e.stopPropagation();
            // allow typing without triggering <a> navigation
            return;
          }
        },
        true,
      ); // capture phase so the <a> parent doesn't navigate
    }
    function expandToQuantityPicker(cartBtn) {
      var pid = cartBtn.dataset.pid;
      var wrapper = document.createElement("div");
      wrapper.className = "cataseek-qty-wrapper";
      wrapper.dataset.pid = pid;
      wrapper.innerHTML =
        '<button class="cataseek-qty-step" data-dir="-1" aria-label="Decrease">&#8722;</button>' +
        '<input class="cataseek-qty-input" type="number" value="1" min="1" max="99">' +
        '<button class="cataseek-qty-step" data-dir="1" aria-label="Increase">&#43;</button>' +
        '<button class="cataseek-qty-confirm" data-pid="' +
        pid +
        '">Add</button>';
      cartBtn.parentNode.replaceChild(wrapper, cartBtn);
      wrapper.querySelector(".cataseek-qty-input").focus();
    }
    function adjustQty(btn) {
      var wrapper = btn.closest(".cataseek-qty-wrapper");
      var input = wrapper.querySelector(".cataseek-qty-input");
      var current = parseInt(input.value) || 1;
      var dir = parseInt(btn.dataset.dir) || 0;
      input.value = Math.max(1, Math.min(99, current + dir));
    }
    function addToCart(confirmBtn) {
      var wrapper = confirmBtn.closest(".cataseek-qty-wrapper");
      var pid = confirmBtn.dataset.pid;
      var qty =
        parseInt(wrapper.querySelector(".cataseek-qty-input").value) || 1;
      var token =
        typeof prestashop !== "undefined" && prestashop.static_token
          ? prestashop.static_token
          : "";
      confirmBtn.textContent = "...";
      confirmBtn.disabled = true;
      fetch("/index.php?controller=cart", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body:
          "action=update&add=1&ajax=1&qty=" +
          qty +
          "&id_product=" +
          encodeURIComponent(pid) +
          "&token=" +
          encodeURIComponent(token),
      })
        .then(function (r) {
          var status = r.status;
          return r.text().then(function (text) {
            return { status: status, text: text };
          });
        })
        .then(function (response) {
          var data;
          try {
            data = JSON.parse(response.text);
          } catch (e) {
            // PrestaShop returned non-JSON. If status is OK, we assume success
            // because the item was actually added (confirmed by page reload).
            data = { success: response.status >= 200 && response.status < 400 };
          }
          // PS 1.7 usually returns `success: true`. Older PS returns `hasError: false`.
          var isSuccess = false;
          if (data) {
            if (data.success === true || data.hasError === false) {
              isSuccess = true;
            } else if (
              typeof data.success === "undefined" &&
              typeof data.hasError === "undefined" &&
              !data.errors
            ) {
              isSuccess = true; // No explicit error flags, assume success
            }
          }
          if (isSuccess) {
            showCartToast("success");
            try {
              updateCartCount(data.cart ? data.cart.products_count : null);
            } catch (e) {
              console.warn("[Cataseek] Could not update cart count UI", e);
            }
            var cartSvg =
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
              '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path>' +
              '<path d="M3 6h18"></path>' +
              '<path d="M16 10a4 4 0 0 1-8 0"></path>' +
              "</svg>";
            var newBtn = document.createElement("button");
            newBtn.className =
              "cataseek-add-to-cart cataseek-add-to-cart--done";
            newBtn.dataset.pid = pid;
            newBtn.title = "Added!";
            newBtn.innerHTML = cartSvg;
            wrapper.parentNode.replaceChild(newBtn, wrapper);
          } else {
            console.error(
              "[Cataseek] Server rejected cart add:",
              response.text,
            );
            showCartToast("error");
            confirmBtn.textContent = "Add";
            confirmBtn.disabled = false;
          }
        })
        .catch(function (err) {
          console.error("[Cataseek] Add to cart error:", err);
          showCartToast("error");
          if (confirmBtn && confirmBtn.parentNode) {
            confirmBtn.textContent = "Add";
            confirmBtn.disabled = false;
          }
        });
    }
    function showCartToast(type) {
      var existing = document.getElementById("cataseek-cart-toast");
      if (existing) existing.remove();
      var toast = document.createElement("div");
      toast.id = "cataseek-cart-toast";
      toast.className = "cataseek-cart-toast cataseek-cart-toast--" + type;
      toast.textContent =
        type === "success"
          ? "\u2713 Added to cart!"
          : "\u2717 Could not add to cart";
      var modalContent = modal.querySelector(".cataseek-modal-content");
      if (modalContent) modalContent.appendChild(toast);
      setTimeout(function () {
        toast.remove();
      }, 2500);
    }
    function updateCartCount(count) {
      // Trigger PrestaShop's native cart update event so the header bubble refreshes
      if (typeof prestashop !== "undefined") {
        prestashop.emit("updateCart", { reason: { type: "product-add" } });
      }
      // Also try updating visible cart count elements directly
      if (count !== null && count !== undefined) {
        var counters = document.querySelectorAll(
          ".cart-products-count, .header-cart-count, [data-cart-count]",
        );
        counters.forEach(function (el) {
          el.textContent = count;
        });
      }
    }
    function renderFilters() {
      var html = "";
      var hasFilters = false;
      var activeCount = 0;
      if (state.selectedFilters && state.selectedFilters.categories) {
        activeCount += state.selectedFilters.categories.length;
      }
      if (
        state.priceRange.currentMin !== null ||
        state.priceRange.currentMax !== null
      ) {
        if (
          state.priceRange.currentMin !== state.priceRange.min ||
          state.priceRange.currentMax !== state.priceRange.max
        ) {
          activeCount++;
        }
      }
      // Mobile Close Button
      html +=
        '<button id="cataseek-filter-close-btn" class="cataseek-mobile-filter-close" aria-label="Close Filters">' +
        '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
        "</button>";
      if (activeCount > 0) {
        html += '<div class="cataseek-filters-header-actions">';
        html +=
          '<button id="cataseek-clear-filters-btn" class="cataseek-clear-filters-btn">' +
          (config.labelClearAll || 'Clear all filters') +
          '</button>';
        html += "</div>";
      }
      // Categories
      if (state.facets && state.facets.categories) {
        var categories = state.facets.categories;
        var keys = Object.keys(categories).sort(function (a, b) {
          return categories[b] - categories[a];
        });
        if (keys.length > 0) {
          hasFilters = true;
          html +=
            '<div class="cataseek-filter-group">' +
            '<div class="cataseek-filter-title">' + (config.labelCategories || 'Categories') + '</div>' +
            '<ul class="cataseek-filter-list">' +
            keys
              .map(function (cat) {
                var checked =
                  state.selectedFilters.categories.indexOf(cat) > -1;
                return (
                  '<li class="cataseek-filter-item">' +
                  '<label class="cataseek-filter-label">' +
                  '<input type="checkbox" class="cataseek-filter-checkbox" value="' +
                  escapeHtml(cat) +
                  '" ' +
                  (checked ? "checked" : "") +
                  ' data-type="categories">' +
                  "<span>" +
                  escapeHtml(cat) +
                  "</span>" +
                  '<span class="cataseek-filter-count">' +
                  categories[cat] +
                  "</span>" +
                  "</label>" +
                  "</li>"
                );
              })
              .join("") +
            "</ul>" +
            "</div>";
        }
      }
      // Price Slider
      if (
        state.priceRange.min !== null &&
        state.priceRange.max !== null &&
        state.priceRange.min < state.priceRange.max
      ) {
        hasFilters = true;
        var curMin =
          state.priceRange.currentMin !== null
            ? state.priceRange.currentMin
            : state.priceRange.min;
        var curMax =
          state.priceRange.currentMax !== null
            ? state.priceRange.currentMax
            : state.priceRange.max;
        html +=
          '<div class="cataseek-filter-group">' +
          '<div class="cataseek-filter-title">' + (config.labelPrice || 'Price') + '</div>' +
          '<div class="cataseek-price-slider-container">' +
          '<div class="cataseek-price-range-inputs">' +
          '<span class="cataseek-price-input-box">' +
          Math.floor(curMin) +
          currency +
          "</span>" +
          '<span class="cataseek-price-input-box">' +
          Math.ceil(curMax) +
          currency +
          "</span>" +
          "</div>" +
          '<div id="cataseek-slider-root" class="cataseek-slider-track">' +
          '<div class="cataseek-slider-range" id="cataseek-slider-range"></div>' +
          '<div class="cataseek-slider-handle" id="cataseek-handle-min"></div>' +
          '<div class="cataseek-slider-handle" id="cataseek-handle-max"></div>' +
          "</div>" +
          '<div class="cataseek-slider-labels">' +
          "<span>" +
          state.priceRange.min +
          currency +
          "</span>" +
          "<span>" +
          Math.round((state.priceRange.min + state.priceRange.max) / 2) +
          currency +
          "</span>" +
          "<span>" +
          state.priceRange.max +
          currency +
          "</span>" +
          "</div>" +
          "</div>" +
          "</div>";
      }
      filtersSidebar.innerHTML = html;
      filtersSidebar.style.display = "block";
      if (hasFilters && mobileFilterBtn) {
        // Only show the floating filter button on mobile screens
        if (window.matchMedia("(max-width: 768px)").matches) {
          mobileFilterBtn.style.display = "flex";
        }
      } else if (!hasFilters && mobileFilterBtn) {
        mobileFilterBtn.style.display = "none";
      }
      initPriceSlider();
      // Attach listeners
      var clearBtn = document.getElementById("cataseek-clear-filters-btn");
      if (clearBtn) {
        clearBtn.addEventListener("click", function (e) {
          e.preventDefault();
          state.selectedFilters.categories = [];
          state.priceRange.currentMin = null;
          state.priceRange.currentMax = null;
          state.offset = 0;
          performSearch();
        });
      }
      var closeFilterBtn = document.getElementById("cataseek-filter-close-btn");
      if (closeFilterBtn) {
        closeFilterBtn.addEventListener("click", function (e) {
          e.preventDefault();
          closeMobileFilters();
        });
      }
      filtersSidebar
        .querySelectorAll(".cataseek-filter-checkbox")
        .forEach(function (cb) {
          cb.addEventListener("change", function () {
            var type = this.getAttribute("data-type");
            var value = this.value;
            if (this.checked) state.selectedFilters[type].push(value);
            else
              state.selectedFilters[type] = state.selectedFilters[type].filter(
                function (v) {
                  return v !== value;
                },
              );
            state.offset = 0;
            performSearch();
          });
        });
    }
    // --- Price Slider Internal Logic ---
    function initPriceSlider() {
      var slider = document.getElementById("cataseek-slider-root");
      if (!slider) return;
      var handleMin = document.getElementById("cataseek-handle-min");
      var handleMax = document.getElementById("cataseek-handle-max");
      var rangeBar = document.getElementById("cataseek-slider-range");
      var minVal = state.priceRange.min;
      var maxVal = state.priceRange.max;
      var curMin =
        state.priceRange.currentMin !== null
          ? state.priceRange.currentMin
          : minVal;
      var curMax =
        state.priceRange.currentMax !== null
          ? state.priceRange.currentMax
          : maxVal;
      function updateUI() {
        var range = maxVal - minVal;
        var leftPct = ((curMin - minVal) / range) * 100;
        var rightPct = ((curMax - minVal) / range) * 100;
        handleMin.style.left = leftPct + "%";
        handleMax.style.left = rightPct + "%";
        rangeBar.style.left = leftPct + "%";
        rangeBar.style.width = rightPct - leftPct + "%";
      }
      updateUI();
      function onDrag(e, type) {
        var rect = slider.getBoundingClientRect();
        var x = (e.clientX || (e.touches && e.touches[0].clientX)) - rect.left;
        var pct = Math.max(0, Math.min(100, (x / rect.width) * 100));
        var val = minVal + (pct / 100) * (maxVal - minVal);
        if (type === "min") curMin = Math.min(val, curMax - 1);
        else curMax = Math.max(val, curMin + 1);
        state.priceRange.currentMin = curMin;
        state.priceRange.currentMax = curMax;
        updateUI();
        // Update text boxes immediately
        var boxes = filtersSidebar.querySelectorAll(
          ".cataseek-price-input-box",
        );
        if (boxes.length === 2) {
          boxes[0].innerText = Math.floor(curMin) + currency;
          boxes[1].innerText = Math.ceil(curMax) + currency;
        }
        // Debounce search
        clearTimeout(state.debounceTimer);
        state.debounceTimer = setTimeout(function () {
          state.offset = 0;
          performSearch();
        }, 400);
      }
      function startDrag(e, type) {
        e.preventDefault();
        var moveHandler = function (me) {
          onDrag(me, type);
        };
        var upHandler = function () {
          document.removeEventListener("mousemove", moveHandler);
          document.removeEventListener("mouseup", upHandler);
          document.removeEventListener("touchmove", moveHandler);
          document.removeEventListener("touchend", upHandler);
        };
        document.addEventListener("mousemove", moveHandler);
        document.addEventListener("mouseup", upHandler);
        document.addEventListener("touchmove", moveHandler);
        document.addEventListener("touchend", upHandler);
      }
      handleMin.addEventListener("mousedown", function (e) {
        startDrag(e, "min");
      });
      handleMax.addEventListener("mousedown", function (e) {
        startDrag(e, "max");
      });
      handleMin.addEventListener("touchstart", function (e) {
        startDrag(e, "min");
      });
      handleMax.addEventListener("touchstart", function (e) {
        startDrag(e, "max");
      });
    }
    // --- Helpers ---
    function showSkeletons() {
      hideAllStates();
      loadingEl.style.display = "block";
      if (sortingContainer) sortingContainer.style.display = "none";
    }
    function hideAllStates() {
      loadingEl.style.display = "none";
      noResultsEl.style.display = "none";
      resultsContainer.style.display = "none";
    }
    function showDiscoveryState() {
      hideAllStates();
      resetSearchResults();
      if (cachedDiscoveryHtml) {
        resultsContainer.innerHTML =
          '<div class="cataseek-discovery-section"><h3 class="cataseek-discovery-title">' +
          escapeHtml(trendingTitle) +
          "</h3>" +
          cachedDiscoveryHtml +
          "</div>";
        resultsContainer.style.display = "block";
      } else if (!isFetchingDiscovery) {
        fetchDiscoveryProducts();
      } else {
        showSkeletons();
      }
    }
    function fetchDiscoveryProducts() {
      isFetchingDiscovery = true;
      showSkeletons();
      var domain = config.shopDomain || window.location.hostname;
      var payload = { query: "", limit: 12, is_discovery: true };
      if (config.language) payload.language = config.language;
      if (config.storeId) payload.store_id = config.storeId;
      fetch(apiUrl + "/products/public/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": apiKey,
          "X-Store-Domain": domain,
        },
        body: JSON.stringify(payload),
      })
        .then(function (res) {
          return res.json();
        })
        .then(function (data) {
          if (data.results && data.results.length > 0) {
            cachedDiscoveryHtml =
              '<div class="cataseek-products-grid">' +
              data.results
                .map(function (h) {
                  return productCard(h, "");
                })
                .join("") +
              "</div>";
          } else {
            cachedDiscoveryHtml =
              '<div class="cataseek-empty-state"><p>Start typing to search products...</p></div>';
          }
          isFetchingDiscovery = false;
          if (!searchInput || searchInput.value.trim().length < minChars) {
            showDiscoveryState();
          }
        })
        .catch(function () {
          isFetchingDiscovery = false;
          cachedDiscoveryHtml =
            '<div class="cataseek-empty-state"><p>Start typing to search products...</p></div>';
          if (!searchInput || searchInput.value.trim().length < minChars) {
            showDiscoveryState();
          }
        });
    }
    function showEmptyState() {
      hideAllStates();
      resultsCountEl.innerText = "";
      resultsContainer.innerHTML =
        '<div class="cataseek-empty-state"><p>Start typing to search products...</p></div>';
      resultsContainer.style.display = "block";
    }
    function showError(msg) {
      hideAllStates();
      resultsContainer.innerHTML =
        '<div class="cataseek-error-state"><p>Error: ' +
        escapeHtml(msg) +
        "</p></div>";
      resultsContainer.style.display = "block";
    }
    function highlight(text, query) {
      if (!query) return text;
      var escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return text.replace(
        new RegExp("(" + escaped + ")", "gi"),
        "<mark>$1</mark>",
      );
    }
    function formatDisplayPrice(price) {
      if (price === null || price === undefined) return "";
      return parseFloat(price).toFixed(2) + " " + currency;
    }
    function escapeHtml(text) {
      if (!text) return "";
      var d = document.createElement("div");
      d.appendChild(document.createTextNode(String(text)));
      return d.innerHTML;
    }
    // ═══════════════════════════════════════════════════════════
    // SUGGESTION SYSTEM
    // ═══════════════════════════════════════════════════════════

    // ─── localStorage helpers ───
    var RECENT_KEY = "cataseek_recent_" + (config.apiKey || "default");
    var MAX_RECENT = 6;

    function loadRecentSearches() {
      try {
        return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      } catch (e) {
        return [];
      }
    }

    function saveRecentSearch(q) {
      if (!q || q.length < 2) return;
      var list = loadRecentSearches();
      // Remove duplicate, then prepend
      list = list.filter(function (s) {
        return s.toLowerCase() !== q.toLowerCase();
      });
      list.unshift(q.toLowerCase());
      if (list.length > MAX_RECENT) list = list.slice(0, MAX_RECENT);
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      } catch (e) {}
    }

    function removeRecentSearch(q) {
      var list = loadRecentSearches().filter(function (s) {
        return s !== q;
      });
      try {
        localStorage.setItem(RECENT_KEY, JSON.stringify(list));
      } catch (e) {}
    }

    // ─── Responsive pill count ───
    // Returns how many pills should be visible based on the current container width.
    function getResponsivePillCount() {
      var w = searchInputWrapper
        ? searchInputWrapper.offsetWidth
        : window.innerWidth;
      if (w < 320) return 2;
      if (w < 480) return 3;
      if (w < 640) return 4;
      return 6; // default max
    }

    function applyResponsivePillCount() {
      if (!suggestionPills) return;
      var count = getResponsivePillCount();
      // Remove all limit classes, add the right one
      suggestionPills.classList.remove(
        "cataseek-pills-2",
        "cataseek-pills-3",
        "cataseek-pills-4",
      );
      if (count < 6) {
        suggestionPills.classList.add("cataseek-pills-" + count);
      }
    }

    // ─── Show / hide the suggestion bar ───
    function showSuggestions() {
      if (suggestionBar) suggestionBar.style.display = "flex";
    }

    function hideSuggestions() {
      if (suggestionBar) suggestionBar.style.display = "none";
    }

    // ─── Render recent searches (when input is empty / short) ───
    function renderRecentPills() {
      var recents = loadRecentSearches();
      if (!recents.length || !suggestionPills) {
        hideSuggestions();
        return;
      }
      applyResponsivePillCount();
      var html = recents
        .map(function (q) {
          var escaped = escapeHtml(q);
          return (
            '<button type="button" class="cataseek-suggestion-pill" data-query="' +
            escaped +
            '">' +
            '<span class="cataseek-pill-bold">' +
            escaped +
            "</span>" +
            '<button type="button" class="cataseek-pill-delete" data-delete="' +
            escaped +
            '" aria-label="Remove">&#x2715;</button>' +
            "</button>"
          );
        })
        .join("");
      suggestionPills.innerHTML = html;
      showSuggestions();
    }

    // ─── Render predictive suggestion pills (receives plain string[] from /public/suggestions) ───
    function renderSuggestionPills(suggestions, inputValue) {
      if (!suggestions || !suggestions.length || !suggestionPills) {
        hideSuggestions();
        return;
      }
      applyResponsivePillCount();

      var inputLower = inputValue.toLowerCase();

      var html = suggestions
        .map(function (sugg) {
          // Bold the typed prefix, lighter for the predicted continuation
          var boldPart, lightPart;
          if (sugg.indexOf(inputLower) === 0) {
            boldPart = escapeHtml(inputValue.toLowerCase());
            lightPart = escapeHtml(sugg.slice(inputValue.length));
          } else {
            boldPart = escapeHtml(sugg);
            lightPart = "";
          }
          return (
            '<button type="button" class="cataseek-suggestion-pill" data-query="' +
            escapeHtml(sugg) +
            '">' +
            '<span class="cataseek-pill-bold">' +
            boldPart +
            "</span>" +
            (lightPart
              ? '<span class="cataseek-pill-light">' + lightPart + "</span>"
              : "") +
            "</button>"
          );
        })
        .join("");

      suggestionPills.innerHTML = html;
      showSuggestions();
    }

    // ─── Pill click delegation — bound ONCE at startup, never re-added ───
    // Attaching inside bindPillEvents() on every render caused listener stacking:
    // after typing N characters, N listeners were queued → one pill click fired
    // startNewSearch() N times and inflated the search count by N.
    if (suggestionPills) {
      suggestionPills.addEventListener("click", function (e) {
        // Delete button (recent searches)
        var delBtn = e.target.closest(".cataseek-pill-delete");
        if (delBtn) {
          e.stopPropagation();
          var toDelete = delBtn.getAttribute("data-delete");
          removeRecentSearch(toDelete);
          renderRecentPills();
          return;
        }
        // Pill itself — this IS an explicit user commit, so save to recent
        var pill = e.target.closest(".cataseek-suggestion-pill");
        if (pill) {
          var q = pill.getAttribute("data-query");
          if (q) {
            if (searchInput) searchInput.value = q;
            saveRecentSearch(q); // explicit commit
            hideSuggestions();
            startNewSearch(q);
          }
        }
      });
    }

    // ─── Helpers ---
    function shadeColor(color, percent) {
      try {
        var num = parseInt(color.replace("#", ""), 16);
        var r = Math.min(255, Math.max(0, (num >> 16) + percent));
        var g = Math.min(255, Math.max(0, ((num >> 8) & 0x00ff) + percent));
        var b = Math.min(255, Math.max(0, (num & 0x0000ff) + percent));
        return (
          "#" + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1)
        );
      } catch (e) {
        return color;
      }
    }
  });
})();
