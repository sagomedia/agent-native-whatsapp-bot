import {prepareOwnerRead} from './redesign-api.js';
import {productListRead} from './owner-view-reads.js';

let started = false;
let startup: AbortController | undefined;

export function prepareCatalogEntry() {
  if (started) return;
  started = true;
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname !== '/owner' || params.get('view') !== 'catalog') return;
  if (params.get('import') === '1' || params.get('bulk') === '1' ||
      params.get('visibility') === 'draft' || params.get('advanced') === '1' ||
      params.get('drafts') === '1' || params.get('draft')) return;
  if (document.hidden || navigator.onLine === false) return;

  startup = new AbortController();
  prepareOwnerRead(productListRead(), startup.signal);
  void import('./RedesignProducts.js').catch(() => {
    // The route boundary provides recovery if the import still fails when rendered.
  });
}

export function cancelCatalogEntry() {
  startup?.abort();
  startup = undefined;
}
