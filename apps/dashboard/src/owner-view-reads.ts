export const orderStages = ['new', 'ready', 'completed', 'all'] as const;

export function orderReads(params: URLSearchParams) {
  const rawStage = params.get('orderStage');
  const stage = orderStages.find(value => value === rawStage) ?? 'new';
  const page = Math.max(1, Number(params.get('orderPage')) || 1);
  const search = params.get('orderSearch') ?? '';
  const selectedId = params.get('order');
  const query = new URLSearchParams({
    details: '0', scope: 'orders', orderView: 'compact',
    orderStage: stage, orderSearch: search, orderPage: String(page),
  });
  const listPath = 'snapshot?' + query;
  if (selectedId) query.set('order', selectedId);
  return {stage, page, search, selectedId, listPath, readPath: 'snapshot?' + query};
}

export function inboxRead(params: URLSearchParams, needsReply = false) {
  const query = new URLSearchParams({
    details: '0', scope: 'inbox',
    inboxPage: String(Math.max(1, Number(params.get('inboxPage')) || 1)),
    inboxSearch: params.get('inboxSearch') ?? '', inboxHelp: needsReply ? '1' : '0',
  });
  const conversation = params.get('conversation');
  if (conversation) query.set('conversation', conversation);
  return 'snapshot?' + query;
}

export const chatHistoryRead = (id: string) => 'conversations/' + encodeURIComponent(id) + '?resume=1';

export function productListRead(query = '', stock = '', cursor?: string) {
  const params = new URLSearchParams({q: query, limit: '50', stock, metadata: 'list'});
  if (cursor) params.set('cursor', cursor);
  return 'catalog?' + params;
}
