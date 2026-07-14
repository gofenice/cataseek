{*
 * Cataseek - AI-Powered Search SaaS for PrestaShop
 *
 * @author    gofenice
 * @copyright 2026 gofenice
 * @license   Commercial
 * @version   1.0.0
 *}

{if !$custom_selector}
<div id="cataseek-search-container" class="cataseek-position-{$icon_position|escape:'html':'UTF-8'|lower}">
    <button id="cataseek-search-trigger" class="cataseek-search-btn cataseek-icon-only"
            aria-label="{l s='Open AI Search' mod='cataseek'}"
            style="color: {$icon_color|escape:'html':'UTF-8'};">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
        </svg>
    </button>
</div>
{else}
{* Custom selector mode: render a hidden placeholder so JS can still find #cataseek-search-trigger if needed *}
<div id="cataseek-search-container" style="display:none;"><button id="cataseek-search-trigger" style="display:none;"></button></div>
{/if}

{* Search Modal *}
<div id="cataseek-modal" class="cataseek-modal cataseek-modal-{$modal_size|escape:'html':'UTF-8'|lower}" style="display: none;">
    <div class="cataseek-modal-overlay"></div>
    <div class="cataseek-modal-content">
        <div class="cataseek-modal-header">
            {if isset($shop_logo) && $shop_logo}
                <div class="cataseek-logo-wrapper">
                    <img src="{$shop_logo|escape:'html':'UTF-8'}" alt="Logo" class="cataseek-logo" />
                </div>
            {/if}

            <div class="cataseek-search-input-wrapper">
                <svg class="cataseek-search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <path d="m21 21-4.35-4.35"></path>
                </svg>
                <input
                    type="text"
                    id="cataseek-search-input"
                    class="cataseek-search-input"
                    placeholder="{l s='Search for products...' mod='cataseek'}"
                    autocomplete="off"
                    spellcheck="false"
                />
                <button id="cataseek-voice-search-btn" class="cataseek-voice-btn" type="button" aria-label="{l s='Voice Search' mod='cataseek'}" style="display: none;" title="{l s='Search by voice' mod='cataseek'}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                        <line x1="12" y1="19" x2="12" y2="22"></line>
                    </svg>
                </button>
                <button id="cataseek-modal-close" class="cataseek-close-btn" aria-label="{l s='Close' mod='cataseek'}">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>
        </div>

        {* Suggestion pills — between header and body, stacks below the search row *}
        <div id="cataseek-suggestions-bar" class="cataseek-suggestions-bar" style="display:none;">
            <div id="cataseek-suggestions-pills" class="cataseek-suggestions-pills"></div>
        </div>

        <div class="cataseek-modal-body">
            <div class="cataseek-modal-main">
                <div class="cataseek-filter-overlay" id="cataseek-filter-overlay" style="display: none;"></div>
                <aside id="cataseek-filters" class="cataseek-filters" style="display: none;">
                    {* Filter content will be injected by JS *}
                </aside>

                <div class="cataseek-content-area">
                    <div class="cataseek-results-header">
                        <span id="cataseek-results-count" class="cataseek-results-count"></span>
                        <div class="cataseek-sorting" style="display: none;">
                            <label>{l s='Sort by:' mod='cataseek'}</label>
                            <select id="cataseek-sort-select">
                                <option value="relevance">{l s='Relevance' mod='cataseek'}</option>
                                <option value="price:asc">{l s='Price: Low to High' mod='cataseek'}</option>
                                <option value="price:desc">{l s='Price: High to Low' mod='cataseek'}</option>
                            </select>
                        </div>
                    </div>

                    <div id="cataseek-search-results" class="cataseek-results">
                        <div class="cataseek-empty-state">
                            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                                <circle cx="11" cy="11" r="8"></circle>
                                <path d="m21 21-4.35-4.35"></path>
                            </svg>
                            <p>{l s='Start typing to search products...' mod='cataseek'}</p>
                        </div>
                    </div>

                    <div id="cataseek-loading" class="cataseek-loading" style="display: none;">
                        <div class="cataseek-products-grid">
                            {for $i=1 to 6}
                                <div class="cataseek-product-item">
                                    <div class="cataseek-skeleton cataseek-skeleton-image"></div>
                                    <div class="cataseek-product-info">
                                        <div class="cataseek-skeleton cataseek-skeleton-text" style="width: 90%"></div>
                                        <div class="cataseek-skeleton cataseek-skeleton-text" style="width: 60%"></div>
                                        <div class="cataseek-skeleton cataseek-skeleton-price"></div>
                                    </div>
                                </div>
                            {/for}
                        </div>
                    </div>

                    <div id="cataseek-no-results" class="cataseek-no-results" style="display: none;">
                        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <p>{l s='No products found' mod='cataseek'}</p>
                    </div>

                    <button id="cataseek-mobile-filter-btn" class="cataseek-mobile-filter-btn" style="display: none;" aria-label="{l s='Filters' mod='cataseek'}">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="4" y1="21" x2="4" y2="14"></line>
                            <line x1="4" y1="10" x2="4" y2="3"></line>
                            <line x1="12" y1="21" x2="12" y2="12"></line>
                            <line x1="12" y1="8" x2="12" y2="3"></line>
                            <line x1="20" y1="21" x2="20" y2="16"></line>
                            <line x1="20" y1="12" x2="20" y2="3"></line>
                            <line x1="1" y1="14" x2="7" y2="14"></line>
                            <line x1="9" y1="8" x2="15" y2="8"></line>
                            <line x1="17" y1="16" x2="23" y2="16"></line>
                        </svg>
                    </button>
                </div>
            </div>
        </div>

        <div class="cataseek-modal-footer">
            <span class="cataseek-powered">
                {l s='Powered by' mod='cataseek'} <strong>Cataseek AI</strong>
            </span>
        </div>
    </div>
</div>
